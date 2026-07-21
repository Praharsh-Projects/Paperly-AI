import { StateGraph, END, START, Annotation } from "@langchain/langgraph";
import { HumanMessage, AIMessage, BaseMessage } from "@langchain/core/messages";
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
  SystemMessagePromptTemplate,
} from "@langchain/core/prompts";
import { ChatOpenAI } from "@langchain/openai";
import { Runnable, RunnableConfig } from "@langchain/core/runnables";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import {
  AGENT_PROMPTS,
  buildDeciderReviewPrompt,
  createSafeTraceEvent,
  nextRevisionCount,
  parseDeciderDecision,
  redactSensitiveText,
  routeAgentStep,
  type AgentName,
} from "./agent-quality";

// Add OpenRouter integration
const OPENROUTER_API_BASE = process.env.OPENROUTER_API_BASE;
const DEFAULT_MODEL_FALLBACK = "qwen/qwq-32b:free";

interface GenerateQuestionsParams {
  questionHeader: string;
  questionDescription: string;
  apiKey: string;
  uploadedFiles?: string[]; // Make optional
  fileUrls?: string[]; // Add fileUrls parameter
  siteUrl?: string; // For OpenRouter HTTP-Referer
  siteName?: string; // For OpenRouter X-Title
  modelName: string; // Changed from optional to required
  // stream option removed as streaming is now the default behavior
}

// Define state for our multi-agent system
const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
  }),
  sender: Annotation<string>({
    reducer: (x, y) => y ?? x ?? "user",
    default: () => "user",
  }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extractedKeywords: Annotation<Record<string, any>>({
    reducer: (x, y) => ({ ...x, ...y }),
    default: () => ({}),
  }),
  questionContent: Annotation<string>({
    reducer: (_, y) => y,
    default: () => "",
  }),
  analysisResult: Annotation<string>({
    reducer: (_, y) => y,
    default: () => "",
  }),
  revisionCount: Annotation<number>({
    reducer: (x, y) => y ?? x ?? 0,
    default: () => 0,
  }),
  isCompleted: Annotation<boolean>({
    reducer: (_, y) => y,
    default: () => false,
  }),
});

/**
 * Create a custom LLM client that uses OpenRouter instead of OpenAI directly
 */
class OpenRouterLLM extends ChatOpenAI {
  private siteUrl: string;
  private siteName: string;

  constructor(options: {
    openRouterApiKey: string;
    modelName?: string;
    temperature?: number;
    siteUrl?: string;
    siteName?: string;
  }) {
    super({
      modelName: options.modelName || DEFAULT_MODEL_FALLBACK,
      openAIApiKey: options.openRouterApiKey,
      temperature: options.temperature ?? 0.2,
      configuration: {
        baseURL: OPENROUTER_API_BASE,
      },
    });

    this.siteUrl = options.siteUrl || "http://localhost:3000";
    this.siteName = options.siteName || "QuestGen";
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async _generate(messages: any[], options?: any, runManager?: any) {
    // Add custom headers for OpenRouter
    const customHeaders = {
      "HTTP-Referer":
        process.env.NEXT_PUBLIC_OPENROUTER_SITE_URL || this.siteUrl,
      "X-Title": this.siteName,
    };

    // Merge headers with any existing ones
    if (!options) options = {};
    if (!options.headers) options.headers = {};
    options.headers = { ...options.headers, ...customHeaders };

    return super._generate(messages, options, runManager);
  }
}

/**
 * Create an agent from a prompt template
 */
async function createAgentWithPrompt(
  llm: ChatOpenAI,
  systemMessage: string
): Promise<Runnable> {
  const prompt = ChatPromptTemplate.fromMessages([
    SystemMessagePromptTemplate.fromTemplate(systemMessage),
    new MessagesPlaceholder("messages"),
  ]);

  return prompt.pipe(llm);
}

async function runAgentNode(props: {
  state: typeof AgentState.State;
  agent: Runnable;
  name: AgentName;
  config?: RunnableConfig;
}) {
  const { state, agent, name, config } = props;

  console.info(
    createSafeTraceEvent({
      agent: name,
      phase: "started",
      revisionCount: state.revisionCount,
    })
  );

  const result = await agent.invoke(state, config);

  // Convert the agent output to an AI message with the agent's name
  const aiMessage = new AIMessage({ content: result.content, name: name });

  console.info(
    createSafeTraceEvent({
      agent: name,
      phase: "completed",
      revisionCount: state.revisionCount,
      content: typeof result.content === "string" ? result.content : undefined,
    })
  );

  return {
    messages: [aiMessage],
    sender: name,
  };
}

function findLatestAgentMessage(messages: BaseMessage[], name: AgentName) {
  return [...messages].reverse().find((message) => message.name === name);
}

function splitTextIntoChunks(
  text: string,
  chunkSize = 4000,
  chunkOverlap = 200
): string[] {
  if (!text.trim()) return [];

  const chunks: string[] = [];
  const step = chunkSize - chunkOverlap;
  for (let start = 0; start < text.length; start += step) {
    chunks.push(text.slice(start, start + chunkSize));
  }
  return chunks;
}

// Create a multi-agent workflow for question generation
export async function createMultiAgentWorkflow(
  apiKey: string,
  options?: {
    siteUrl?: string;
    siteName?: string;
    modelName?: string;
  }
) {
  // Create LLM using OpenRouter
  const llm = new OpenRouterLLM({
    openRouterApiKey: apiKey,
    modelName: options?.modelName || DEFAULT_MODEL_FALLBACK,
    temperature: 0.6,
    siteUrl: options?.siteUrl,
    siteName: options?.siteName,
  });

  // Create agents with appropriate system prompts
  const extractorAgent = await createAgentWithPrompt(
    llm,
    AGENT_PROMPTS.extractor
  );

  const questionCreatorAgent = await createAgentWithPrompt(
    llm,
    AGENT_PROMPTS.questionCreator
  );

  const questionAnalysisAgent = await createAgentWithPrompt(
    llm,
    AGENT_PROMPTS.questionAnalysis
  );

  const deciderAgent = await createAgentWithPrompt(
    llm,
    AGENT_PROMPTS.decider
  );

  const formatterAgent = await createAgentWithPrompt(
    llm,
    AGENT_PROMPTS.formatter
  );

  // Define agent nodes
  async function extractorNode(
    state: typeof AgentState.State,
    config?: RunnableConfig
  ) {
    console.log("🔍 Starting Extractor Agent...");
    // Only provide question header and description, not the PDF content
    const messages = [...state.messages];
    const userMessage = messages.find(
      (msg) => msg instanceof HumanMessage
    ) as HumanMessage;

    if (userMessage) {
      const content = userMessage.content as string;
      // Extract just the header and description part, not the PDF content
      const headerDescriptionPart = content.split(
        "Content to generate questions from:"
      )[0];

      // Replace the original message with just header and description
      const newMessage = new HumanMessage({
        content: `Extract key information from this request: ${headerDescriptionPart}`,
      });

      const extractorState = {
        ...state,
        messages: [newMessage],
      };

      return runAgentNode({
        state: extractorState,
        agent: extractorAgent,
        name: "Extractor",
        config,
      });
    }

    return runAgentNode({
      state,
      agent: extractorAgent,
      name: "Extractor",
      config,
    });
  }

  async function questionCreatorNode(
    state: typeof AgentState.State,
    config?: RunnableConfig
  ) {
    console.log("📝 Starting Question Creator Agent...");
    // Include extracted keywords, original prompt with PDF content
    const messages = [...state.messages];
    const extractorMessage = findLatestAgentMessage(messages, "Extractor");
    const originalMessage = messages.find(
      (msg) => msg instanceof HumanMessage
    ) as HumanMessage;

    if (extractorMessage && originalMessage) {
      const extractorContent = extractorMessage.content as string;
      // Add a human message with instructions that includes PDF content and extractor keywords
      messages.push(
        new HumanMessage({
          content: `Create questions based on these requirements:
1. Use the extracted keywords and requirements: ${extractorContent}
2. Original request: ${originalMessage.content}
Create appropriate questions using the provided PDF content.`,
        })
      );
    }

    const updatedState = { ...state, messages };

    const result = await runAgentNode({
      state: updatedState,
      agent: questionCreatorAgent,
      name: "QuestionCreator",
      config,
    });

    // Store the created questions
    return {
      ...result,
      questionContent: result.messages[0].content,
      revisionCount: nextRevisionCount({
        previousSender: state.sender,
        revisionCount: state.revisionCount,
      }),
    };
  }

  async function questionAnalysisNode(
    state: typeof AgentState.State,
    config?: RunnableConfig
  ) {
    console.log("🔍 Starting Question Analysis Agent...");
    // Include questions and the extractor's keywords for analysis
    const messages = [...state.messages];
    const creatorMessage = findLatestAgentMessage(messages, "QuestionCreator");
    const extractorMessage = findLatestAgentMessage(messages, "Extractor");

    if (creatorMessage && extractorMessage) {
      console.log(
        "📋 Analyzing and modifying questions created by Question Creator"
      );
      messages.push(
        new HumanMessage({
          content: `Analyze and improve these questions:
1. Questions to analyze: ${creatorMessage.content}
2. Requirements from extraction: ${extractorMessage.content}
3. Focus on checking and modifying questions based on difficulty levels (hard/easy/conceptual)
4. Ensure questions meet all requirements and are clear and well-structured`,
        })
      );
    }

    const updatedState = { ...state, messages };

    const result = await runAgentNode({
      state: updatedState,
      agent: questionAnalysisAgent,
      name: "QuestionAnalysis",
      config,
    });

    // Store the analysis result
    return {
      ...result,
      analysisResult: result.messages[0].content,
    };
  }

  async function deciderNode(
    state: typeof AgentState.State,
    config?: RunnableConfig
  ) {
    console.log("🧠 Starting Decider Agent...");
    // Include both QuestionCreator and QuestionAnalysis outputs for decision
    const messages = [...state.messages];
    const analysisMessage = findLatestAgentMessage(messages, "QuestionAnalysis");
    const creatorMessage = findLatestAgentMessage(messages, "QuestionCreator");

    if (analysisMessage && creatorMessage) {
      messages.push(
        new HumanMessage({
          content: buildDeciderReviewPrompt({
            questions: String(creatorMessage.content),
            analysis: String(analysisMessage.content),
          }),
        })
      );
    }

    const updatedState = { ...state, messages };

    return runAgentNode({
      state: updatedState,
      agent: deciderAgent,
      name: "Decider",
      config,
    });
  }

  async function formatterNode(
    state: typeof AgentState.State,
    config?: RunnableConfig
  ) {
    console.log("📄 Starting Formatter Agent...");
    // Include both QuestionCreator and QuestionAnalysis outputs for formatting
    const messages = [...state.messages];
    const creatorMessage = findLatestAgentMessage(messages, "QuestionCreator");
    const analysisMessage = findLatestAgentMessage(messages, "QuestionAnalysis");

    if (creatorMessage && analysisMessage) {
      console.log("📋 Formatting final exam paper");
      messages.push(
        new HumanMessage({
          content: `Format these questions into a professional exam paper:
1. Original questions: ${creatorMessage.content}
2. Analysis and modifications: ${analysisMessage.content}

Create a well-structured, professional exam paper that incorporates all the feedback and improvements.`,
        })
      );
    }

    const updatedState = { ...state, messages };

    const result = await runAgentNode({
      state: updatedState,
      agent: formatterAgent,
      name: "Formatter",
      config,
    });

    // Mark as completed
    console.log("🎉 Question generation process completed!");
    return {
      ...result,
      isCompleted: true,
    };
  }

  // Router function to determine the next step
  function mainRouter(state: typeof AgentState.State) {
    const messages = state.messages;
    const lastMessage = messages[messages.length - 1] as AIMessage;
    const content =
      typeof lastMessage.content === "string" ? lastMessage.content : "";
    const route = routeAgentStep({
      sender: lastMessage.name ?? "Unknown",
      content,
      revisionCount: state.revisionCount,
    });

    console.info(
      createSafeTraceEvent({
        agent: (lastMessage.name ?? "Formatter") as AgentName,
        phase: "routed",
        revisionCount: state.revisionCount,
        content,
        ...(lastMessage.name === "Decider"
          ? { decision: parseDeciderDecision(content) }
          : {}),
      }),
      { route }
    );
    return route;
  }

  // Create the graph
  const workflow = new StateGraph(AgentState)
    // Add nodes
    .addNode("Extractor", extractorNode)
    .addNode("QuestionCreator", questionCreatorNode)
    .addNode("QuestionAnalysis", questionAnalysisNode)
    .addNode("Decider", deciderNode)
    .addNode("Formatter", formatterNode);

  // Add edges for the main workflow
  workflow.addConditionalEdges("Extractor", mainRouter, {
    to_question_creator: "QuestionCreator",
  });

  workflow.addConditionalEdges("QuestionCreator", mainRouter, {
    to_question_analysis: "QuestionAnalysis",
  });

  workflow.addConditionalEdges("QuestionAnalysis", mainRouter, {
    to_decider: "Decider",
  });

  workflow.addConditionalEdges("Decider", mainRouter, {
    to_formatter: "Formatter",
    to_question_creator: "QuestionCreator",
  });

  // Simplify the Formatter edge to always end the workflow
  // No conditional routing needed - always terminate after Formatter
  workflow.addEdge("Formatter", END);

  // Starting point
  workflow.addEdge(START, "Extractor");

  return workflow.compile();
}

// Optimized to handle concurrent agent execution issues with streaming by default
export async function generateQuestions({
  questionHeader,
  questionDescription,
  apiKey,
  fileUrls = [],
  siteUrl,
  siteName,
  modelName,
}: GenerateQuestionsParams) {
  console.log("🚀 Starting question generation process with streaming enabled");

  // New function to process PDF URLs
  const processPDFUrls = async (urls: string[]) => {
    try {
      const extractedTexts: string[] = [];

      for (const url of urls) {
        try {
          try {
            const response = await fetch(url);

            if (!response.ok) {
              throw new Error(
                `Failed to fetch PDF: ${response.status} ${response.statusText}`
              );
            }

            const arrayBuffer = await response.arrayBuffer();
            console.log(`Received PDF data: ${arrayBuffer.byteLength} bytes`);
            const parsed = await pdfParse(Buffer.from(arrayBuffer));
            extractedTexts.push(parsed.text);
            console.log("Successfully processed one PDF source");
          } catch (loadError) {
            console.error(
              "Error processing a PDF source:",
              redactSensitiveText(String(loadError))
            );
          }
        } catch (urlError) {
          console.error(
            "Error processing a PDF URL:",
            redactSensitiveText(String(urlError))
          );
        }
      }

      const chunks = extractedTexts.flatMap((text) => splitTextIntoChunks(text));
      console.log(`Split extracted PDF text into ${chunks.length} chunks`);
      return chunks;
    } catch (error) {
      console.error(
        "Error processing PDF URLs:",
        redactSensitiveText(String(error))
      );
      throw new Error(
        `Failed to process PDF URLs: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  };

  try {
    // Process files from either local paths or URLs based on what's available
    console.log("📚 Processing PDF files");

    let fileChunks: string[] = [];

    // If we have URLs, process those
    if (fileUrls && fileUrls.length > 0) {
      console.log(`Processing ${fileUrls.length} PDF URLs`);
      fileChunks = await processPDFUrls(fileUrls);
    }

    const fileText = fileChunks.join("\n\n");
    console.log(`📄 Extracted ${fileText.length} characters of text from PDFs`);

    // Combine file text with question header and description
    const inputPrompt = `
Question Header: ${questionHeader}
Question Description: ${questionDescription}

Content to generate questions from:
${fileText}
    `;

    // Create and execute the workflow with OpenRouter options
    console.log("🔄 Creating multi-agent workflow");
    const workflow = await createMultiAgentWorkflow(apiKey, {
      siteUrl,
      siteName,
      modelName,
    });

    console.log("🚀 Invoking multi-agent workflow with streaming");

    // Add an initial state with iteration count 0
    const initialState = {
      messages: [new HumanMessage(inputPrompt)],
      revisionCount: 0,
    };
    const config = {
      configurable: {
        thread_id: "stream_events",
      },
    };

    // Always stream results
    console.log("📊 Streaming mode enabled");

    // Return the stream directly so it can be consumed by the API route
    return {
      success: true,
      stream: await workflow.stream(initialState, config),

      streamEvents: true, // Flag to indicate we're returning a stream
    };
  } catch (error) {
    console.error(
      "Generation error:",
      redactSensitiveText(String(error))
    );
    return {
      success: false,
      error: `Failed to generate questions: ${
        error instanceof Error ? error.message : String(error)
      }`,
      streamEvents: false,
    };
  }
}
