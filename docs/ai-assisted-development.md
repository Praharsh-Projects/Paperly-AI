# AI-assisted development workflow

This repository uses OpenAI Codex as an AI-assisted development tool for bounded maintenance work. The July 2026 quality pass used it to inspect dependency advisories, improve responsive layout behavior, add Playwright coverage, and update verification documentation.

The acceptance path is repository evidence, not generated prose:

1. Inspect the requested scope and the current code before editing.
2. Review the resulting diff for unrelated or unsupported changes.
3. Run ESLint, TypeScript, deterministic unit/evaluation suites, the Next.js production build, and a high-severity dependency audit.
4. Run Playwright against desktop and mobile Chromium profiles.
5. Accept the change as portfolio evidence only after the exact public GitHub Actions commit passes.

The workflow does not treat an AI suggestion, a local-only result, or an unverified claim as completed engineering work.
