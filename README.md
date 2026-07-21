# Paperly AI

Paperly is a learning project for generating exam papers from user-provided PDF material. A Next.js API sends extracted document context through a five-node LangGraph workflow backed by an OpenRouter-compatible chat model:

`Extractor → QuestionCreator → QuestionAnalysis → Decider → Formatter`

The Decider can request one bounded revision before the graph proceeds to formatting. This repository demonstrates agent orchestration, prompt contracts, streaming, evaluation, and defensive handling of uploaded content; it is not presented as a production or customer-data deployment.

## Agent-quality controls

- Versioned prompts keep generation grounded in the supplied material and treat document text as untrusted data.
- The Decider accepts only `PERFECT: <reason>` or `NOT PERFECT: <issues>`; malformed output follows a deterministic bounded-retry policy.
- A real revision counter terminates the feedback loop after one retry and the graph consumes the latest revised messages.
- Deterministic cases evaluate graph routing, decision parsing, and sensitive-data redaction without paid API calls.
- Structured traces record node, phase, prompt version, revision count, and content length without recording raw model output.
- The browser sends the OpenRouter key in a request header, not a query string.
- Uploaded files are deleted on the normal completion and error paths after generation.

## Stack

- Next.js 15, React 19, TypeScript
- LangGraph, LangChain, OpenRouter-compatible models
- Convex file storage
- `pdf-parse` with bounded text chunking
- Vitest, V8 coverage, ESLint, GitHub Actions

## Local setup

Requirements: Node.js 20+ and pnpm 10.28.1.

```bash
git clone https://github.com/Praharsh-Projects/Paperly-AI.git
cd Paperly-AI/code
pnpm install --frozen-lockfile
```

Create `code/.env.local`:

```dotenv
OPENROUTER_API_BASE=https://openrouter.ai/api/v1
NEXT_PUBLIC_OPENROUTER_SITE_URL=http://localhost:3000
NEXT_PUBLIC_CONVEX_URL=https://your-deployment.convex.cloud
```

Initialize a Convex development deployment, then start the UI:

```bash
pnpm exec convex dev
pnpm dev
```

The user supplies an OpenRouter API key in the UI. The key is held in browser state for the active page and sent to the server in the `x-openrouter-api-key` header.

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test:coverage
pnpm eval:agent
pnpm build
```

Run every local quality gate with:

```bash
pnpm quality
```

GitHub Actions runs the same reproducible, frozen-lockfile quality command for pull requests and pushes to `main`. The deterministic suite does not call OpenRouter or Convex.

Latest verified local snapshot:

- 27/27 Vitest checks passed.
- 20/20 deterministic agent evaluation cases passed.
- 100% statements, branches, functions, and lines across the prompt/routing/privacy control modules.
- Next.js production build completed successfully.

## API flow

1. `POST /api/generate-questions` accepts PDF files and returns their Convex document IDs.
2. `GET /api/generate-questions` accepts the generation parameters and file IDs, reads the OpenRouter key from `x-openrouter-api-key`, and streams Server-Sent Events.
3. The route removes uploaded files on normal stream completion and handled generation errors.

## Security and limitations

- Treat the application as a portfolio/learning system, not a vetted production service.
- Do not use real customer, student, or otherwise sensitive documents.
- Cleanup is best-effort. A file uploaded without a subsequent generation request can remain in Convex; a scheduled orphan-file retention job is not implemented.
- The application sends extracted PDF text to the selected external model through OpenRouter. Review provider data terms before using any document.
- The current pipeline chunks PDF text for model context but does **not** implement vector retrieval or claim to be a RAG system.
- CI verifies deterministic code paths and the production build. A live OpenRouter/Convex end-to-end run requires user-managed credentials and is intentionally outside CI.
- Authentication, authorization, rate limiting, malware scanning, and a production privacy review remain out of scope.

## Repository layout

```text
Paperly-AI/
├── .github/workflows/ci.yml
├── README.md
└── code/
    ├── app/                         # UI and streaming API route
    ├── convex/                      # File metadata/storage functions
    ├── evals/                       # Deterministic cases and tests
    ├── scripts/run-agent-evals.ts   # Machine-readable evaluation runner
    ├── services/agent-quality.ts    # Prompt, routing, trace, redaction controls
    └── services/index.ts            # LangGraph workflow and PDF processing
```
