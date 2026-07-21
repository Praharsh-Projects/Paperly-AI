import type { RouteTarget } from "@/services/agent-quality";

export const routingCases: Array<{
  id: string;
  sender: string;
  content?: string;
  revisionCount: number;
  expected: RouteTarget;
}> = [
  {
    id: "extractor advances to creator",
    sender: "Extractor",
    revisionCount: 0,
    expected: "to_question_creator",
  },
  {
    id: "creator advances to analysis",
    sender: "QuestionCreator",
    revisionCount: 0,
    expected: "to_question_analysis",
  },
  {
    id: "analysis advances to decider",
    sender: "QuestionAnalysis",
    revisionCount: 0,
    expected: "to_decider",
  },
  {
    id: "perfect advances to formatter",
    sender: "Decider",
    content: "PERFECT: all criteria are satisfied",
    revisionCount: 0,
    expected: "to_formatter",
  },
  {
    id: "not perfect triggers one revision",
    sender: "Decider",
    content: "NOT PERFECT: two questions are unsupported",
    revisionCount: 0,
    expected: "to_question_creator",
  },
  {
    id: "revision cap terminates loop",
    sender: "Decider",
    content: "NOT PERFECT: one issue remains",
    revisionCount: 1,
    expected: "to_formatter",
  },
  {
    id: "malformed decision retries within budget",
    sender: "Decider",
    content: "Looks good to me",
    revisionCount: 0,
    expected: "to_question_creator",
  },
  {
    id: "malformed decision terminates at cap",
    sender: "Decider",
    content: "Looks good to me",
    revisionCount: 1,
    expected: "to_formatter",
  },
  {
    id: "formatter terminates",
    sender: "Formatter",
    revisionCount: 1,
    expected: "end",
  },
  {
    id: "unknown sender fails closed",
    sender: "Unknown",
    revisionCount: 0,
    expected: "end",
  },
];

export const decisionCases = [
  {
    id: "perfect contract",
    content: "PERFECT: grounded and complete",
    expected: "perfect",
  },
  {
    id: "not perfect contract",
    content: "NOT PERFECT: missing source support",
    expected: "revise",
  },
  {
    id: "not perfect is not substring-perfect",
    content: "NOT PERFECT: revise this",
    expected: "revise",
  },
  {
    id: "legacy bracket output is rejected",
    content: "PERFECT[dont need to explain]",
    expected: "invalid",
  },
  {
    id: "missing explanation is rejected",
    content: "PERFECT:",
    expected: "invalid",
  },
  {
    id: "leading prose is rejected",
    content: "I think PERFECT: ready",
    expected: "invalid",
  },
] as const;

export const redactionCases = [
  {
    id: "OpenRouter key",
    input: "key=sk-or-v1-abcdefghijklmnopqrstuvwxyz",
    forbidden: "sk-or-v1-abcdefghijklmnopqrstuvwxyz",
  },
  {
    id: "generic API key query",
    input: "https://example.test/run?apiKey=top-secret-value&mode=fast",
    forbidden: "top-secret-value",
  },
  {
    id: "email address",
    input: "contact learner@example.org for support",
    forbidden: "learner@example.org",
  },
  {
    id: "international phone number",
    input: "call +46 70 123 45 67 tomorrow",
    forbidden: "+46 70 123 45 67",
  },
] as const;
