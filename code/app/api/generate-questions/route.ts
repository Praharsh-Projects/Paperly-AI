import { NextRequest, NextResponse } from "next/server";
import { generateQuestions } from "@/services/index";

import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { redactSensitiveText } from "@/services/agent-quality";
import { readOpenRouterApiKey } from "@/services/request-security";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const uploadedFileIds: string[] = [];

    // Initialize Convex client
    const convex = new ConvexHttpClient(
      process.env.NEXT_PUBLIC_CONVEX_URL || ""
    );

    if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
      throw new Error("Missing NEXT_PUBLIC_CONVEX_URL environment variable");
    }

    // Extract files from form data
    for (const entry of formData.entries()) {
      const [key, value] = entry as [string, File];

      if (key.startsWith("file-") && value instanceof File) {
        // Upload file to Convex
        try {
          console.log("Processing one uploaded file", {
            contentType: value.type,
            sizeBytes: value.size,
          });

          // Get file buffer
          const buffer = Buffer.from(await value.arrayBuffer());

          // Sanitize filename to prevent issues with special characters
          const sanitizedName = value.name.replace(/[^a-zA-Z0-9.-]/g, "_");

          try {
            // Generate upload URL from Convex
            const uploadUrl = await convex.mutation(
              api.files.generateUploadUrl,
              {
                filename: sanitizedName,
                contentType: value.type || "application/pdf",
              }
            );
            if (!uploadUrl) {
              throw new Error("Failed to get upload URL from Convex");
            }

            // Upload file to the generated URL
            const uploadResponse = await fetch(uploadUrl, {
              method: "POST",
              headers: {
                "Content-Type": value.type || "application/pdf",
              },
              body: buffer,
            });

            if (!uploadResponse.ok) {
              throw new Error(
                `Upload failed with status ${uploadResponse.status}`
              );
            }

            const storageId = await uploadResponse.text();

            // Ensure we have a valid storage ID (not JSON)
            let finalStorageId = storageId;
            if (storageId.startsWith("{") && storageId.includes("storageId")) {
              try {
                const parsed = JSON.parse(storageId);
                finalStorageId = parsed.storageId;
              } catch {
                console.error("Failed to parse storage ID response");
                // Continue with the original value if parsing fails
              }
            }

            // Get the Convex file ID
            const fileId = await convex.mutation(api.files.saveStorageId, {
              filename: sanitizedName,
              contentType: value.type || "application/pdf",
              storageId: finalStorageId,
            });

            uploadedFileIds.push(fileId);
          } catch (convexError) {
            console.error(
              "Convex API error:",
              redactSensitiveText(String(convexError))
            );
            throw convexError;
          }
        } catch (uploadError) {
          console.error(
            "Error uploading a file to Convex:",
            redactSensitiveText(String(uploadError))
          );
          throw new Error("Failed to upload one file to Convex");
        }
      }
    }

    console.log("Files uploaded to Convex", { count: uploadedFileIds.length });

    // Return the uploaded file IDs in the response
    return NextResponse.json(
      {
        message: "success",
        uploadedFiles: uploadedFileIds,
      },
      { status: 200 }
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error(
      "Error processing uploads:",
      redactSensitiveText(String(error))
    );
    return NextResponse.json(
      { message: error.message || "Failed to process request" },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const questionHeader = url.searchParams.get("questionHeader");
    const questionDescription = url.searchParams.get("questionDescription");
    const apiKey = readOpenRouterApiKey(req.headers);
    const modelName = url.searchParams.get("modelName") || "qwen/qwq-32b:free";
    const uploadedFilesParam = url.searchParams.get("uploadedFiles");

    // Validate required parameters
    if (!questionHeader || !questionDescription || !apiKey) {
      return NextResponse.json(
        {
          message:
            "Missing required parameters. Provide questionHeader and questionDescription in the URL, and the OpenRouter key in the x-openrouter-api-key header.",
          required: [
            "questionHeader",
            "questionDescription",
            "x-openrouter-api-key header",
          ],
          received: {
            questionHeader: !!questionHeader,
            questionDescription: !!questionDescription,
            apiKey: !!apiKey,
            modelName: !!modelName,
          },
        },
        { status: 400 }
      );
    }

    // Process Convex file IDs
    let convexFileIds: string[] = [];
    if (uploadedFilesParam) {
      convexFileIds = uploadedFilesParam
        .split(",")
        .filter((file) => file.trim() !== "");
    }

    console.log("Processing generation request", {
      uploadedFileCount: convexFileIds.length,
    });

    // Initialize Convex client for later use in cleanup
    const convex = new ConvexHttpClient(
      process.env.NEXT_PUBLIC_CONVEX_URL || ""
    );

    // Initialize fileData array to store file information
    const fileUrls: string[] = [];

    // Check if we have files to process
    if (convexFileIds.length === 0) {
      console.warn("No uploaded files found for processing");
    } else {
      try {
        // Retrieve download URLs for each file ID
        for (const fileId of convexFileIds) {
          // Get download URL directly from Convex
          const downloadUrl = await convex.query(api.files.getDownloadUrl, {
            id: fileId as Id<"files">,
          });

          if (!downloadUrl) {
            console.warn("Failed to get one requested download URL");
            continue;
          }

          // Add URL to our list
          fileUrls.push(downloadUrl);
        }

        if (fileUrls.length === 0 && convexFileIds.length > 0) {
          return NextResponse.json(
            {
              message: "Failed to retrieve any file URLs from Convex",
            },
            { status: 400 }
          );
        }

        console.log(
          `Successfully retrieved ${fileUrls.length} file URLs from Convex`
        );
      } catch (convexError) {
        console.error(
          "Error retrieving files from Convex:",
          redactSensitiveText(String(convexError))
        );
        return NextResponse.json(
          { message: "Failed to retrieve files from storage" },
          { status: 500 }
        );
      }
    }

    // Use the service to generate questions with streaming
    const result = await generateQuestions({
      questionHeader,
      questionDescription,
      apiKey,
      fileUrls,
      modelName,
    });

    // Function to delete files from Convex
    const cleanupConvexFiles = async () => {
      try {
        console.log("Cleaning up Convex files...");
        for (const fileId of convexFileIds) {
          try {
            await convex.mutation(api.files.deleteFile, {
              id: fileId as Id<"files">,
            });
          } catch (deleteError) {
            console.error(
              "Error deleting one Convex file:",
              redactSensitiveText(String(deleteError))
            );
          }
        }
        console.log("Convex file cleanup completed");
      } catch (cleanupError) {
        console.error(
          "Error during Convex file cleanup:",
          redactSensitiveText(String(cleanupError))
        );
      }
    };

    if (result.stream) {
      // Create a transform stream to handle the SSE data
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      // Track writer state
      let writerClosed = false;

      // Helper function to safely close the writer
      const safelyCloseWriter = async () => {
        try {
          // Only attempt to close if we haven't already closed it
          if (!writerClosed) {
            writerClosed = true;
            await writer.close();
          }
        } catch (closeError) {
          console.error(
            "Error closing writer:",
            redactSensitiveText(String(closeError))
          );
          // We've tried our best to close it, continue with the flow
          writerClosed = true; // Consider it closed even if there was an error
        }
      };

      // Helper function to safely write to the stream
      const safelyWriteToStream = async (data: string) => {
        if (!writerClosed) {
          try {
            await writer.write(encoder.encode(data));
            return true;
          } catch (writeError) {
            console.error(
              "Error writing to stream:",
              redactSensitiveText(String(writeError))
            );
            writerClosed = true; // Consider it closed if we can't write
            return false;
          }
        }
        return false;
      };

      // Process the stream in the background
      (async () => {
        try {
          for await (const event of result.stream) {
            // Check if this is an agent type we want to process
            const agentType = Object.keys(event)[0];

            // Process Formatter output when available; otherwise fall back to the first
            // QuestionCreator output to avoid getting stuck in iterative analysis/decider loops.
            if (agentType !== "Formatter" && agentType !== "QuestionCreator") {
              console.log(`Skipping event from agent: ${agentType}`);
              continue; // Skip this event
            }

            let content = "";

            try {
              const node = (event as Record<
                string,
                {
                  messages?: Array<{ content?: unknown }>;
                  analysisResult?: unknown;
                }
              >)[agentType];
              const messageContent = node?.messages?.[0]?.content;

              if (typeof node?.analysisResult === "string") {
                content = node.analysisResult;
              } else if (typeof messageContent === "string") {
                content = messageContent;
              } else {
                content = JSON.stringify(event);
              }
            } catch {
              // If any error in parsing, use the event as is
              content = JSON.stringify(event);
            }

            // Clean up the content - remove code block formatting
            let cleanContent = content;

            // Remove markdown code block formatting if present
            cleanContent = cleanContent
              .replace(/```(json)?\n/g, "")
              .replace(/```$/g, "");

            // Check if content is JSON (starts with { or [)
            const isJsonContent =
              cleanContent.trim().startsWith("{") ||
              cleanContent.trim().startsWith("[");

            let messageToSend;

            if (isJsonContent) {
              // If it's JSON content, send busy server message
              messageToSend = "server is busy currently try again later";
              console.log("JSON content detected, sending busy server message");

              // Format as proper SSE with a consistent delimiter
              const formattedChunk = `data: ${JSON.stringify({
                type: "error",
                content: messageToSend,
              })}\n\n`;

              // Write the chunk to the stream
              const writeSuccess = await safelyWriteToStream(formattedChunk);
              if (!writeSuccess) break;

              if (agentType === "QuestionCreator") {
                await safelyWriteToStream("event: complete\ndata: done\n\n");
                await cleanupConvexFiles();
                await safelyCloseWriter();
                return;
              }
              // If this content is from QuestionCreator, treat it as a valid final output
              // and terminate streaming early. This prevents infinite graph loops
              // (GraphRecursionError) from breaking the client experience.


              // Close the stream after sending error
              await safelyWriteToStream("event: complete\ndata: done\n\n");

              // Clean up Convex files before closing writer
              await cleanupConvexFiles();

              // Safely close the writer
              await safelyCloseWriter();

              // Exit the processing loop
              return;
            } else {
              // For markdown content, prepare it for sending
              messageToSend = cleanContent;
              const formattedChunk = `data: ${JSON.stringify({
                type: "markdown",
                content: messageToSend,
                isMarkdown: true,
              })}\n\n`;

              console.log(
                `Sending markdown chunk (length: ${formattedChunk.length})`
              );

              // Write the chunk to the stream
              const writeSuccess = await safelyWriteToStream(formattedChunk);
              if (!writeSuccess) break;
            }
          }

          // Signal completion
          await safelyWriteToStream("event: complete\ndata: done\n\n");

          // Clean up Convex files after successful streaming
          await cleanupConvexFiles();

          // Safely close the writer
          await safelyCloseWriter();
        } catch (error: unknown) {
          console.error(
            "Stream error:",
            redactSensitiveText(String(error))
          );
          const errorMessage = redactSensitiveText(
            error instanceof Error
              ? error.message
              : "An unknown error occurred"
          );

          // Try to write the error message if writer is still available
          await safelyWriteToStream(
            `event: error\ndata: ${JSON.stringify({
              error: errorMessage,
            })}\n\n`
          );

          // Clean up Convex files even if we had streaming errors
          await cleanupConvexFiles();

          // Safely close the writer
          await safelyCloseWriter();
        }
      })();

      // Return the readable side of the transform stream as the response
      return new Response(readable, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    } else {
      // Clean up Convex files if we don't have a stream
      await cleanupConvexFiles();

      return NextResponse.json(
        { message: "No stream returned from generation service" },
        { status: 500 }
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error(
      "Error generating questions:",
      redactSensitiveText(String(error))
    );
    return NextResponse.json(
      {
        message: redactSensitiveText(
          error.message || "Failed to generate questions"
        ),
      },
      { status: 500 }
    );
  }
}
