import {
  parseDeciderDecision,
  redactSensitiveText,
  routeAgentStep,
} from "../services/agent-quality";
import {
  decisionCases,
  redactionCases,
  routingCases,
} from "../evals/agent-quality-cases";

type EvaluationResult = {
  id: string;
  category: "routing" | "decision" | "privacy";
  passed: boolean;
};

const results: EvaluationResult[] = [
  ...routingCases.map((testCase) => ({
    id: testCase.id,
    category: "routing" as const,
    passed: routeAgentStep(testCase) === testCase.expected,
  })),
  ...decisionCases.map((testCase) => ({
    id: testCase.id,
    category: "decision" as const,
    passed: parseDeciderDecision(testCase.content) === testCase.expected,
  })),
  ...redactionCases.map((testCase) => ({
    id: testCase.id,
    category: "privacy" as const,
    passed: !redactSensitiveText(testCase.input).includes(testCase.forbidden),
  })),
];

const passed = results.filter((result) => result.passed).length;
const report = {
  suite: "paperly-agent-quality-v1",
  passed,
  total: results.length,
  passRate: Number((passed / results.length).toFixed(4)),
  results,
};

console.log(JSON.stringify(report, null, 2));

if (passed !== results.length) {
  process.exitCode = 1;
}
