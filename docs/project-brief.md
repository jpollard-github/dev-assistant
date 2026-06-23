# Project Brief

## Repo Purpose
- Build a local-first development assistant that coordinates role-specific agents for coding, review, testing, architecture feedback, and technical debt tracking.
- The intended user experience is "a senior engineering team in VS Code," but with explicit approvals, auditable actions, and local-by-default execution.

## How To Work In This Repo
- Install dependencies with `corepack pnpm install` when workspace links or the lockfile need refreshing.
- Validate changes with `corepack pnpm typecheck`, `corepack pnpm test`, and `corepack pnpm build`.
- Smoke test the current CLI orchestration path with `node apps/cli/dist/index.js run "task description"`.
- Read the handoff docs first and only inspect implementation files when the docs do not answer the question.

## Important Constraints
- Preserve the local-first security model: no implicit network use, no silent shell execution expansion, and no casual weakening of approval gates.
- Do not treat the current Phase 1 CLI smoke tests as proof of real file edits or shell execution; those services are still intentionally stubbed.
- Keep the task/event trail auditable. Future changes should preserve structured logging, persisted task history, and explicit lifecycle transitions.

## Architecture Rules Worth Preserving
- Package boundaries matter: `packages/core` owns orchestration, `packages/agents` owns role contracts and output schemas, and `packages/shared` owns shared config/logging primitives.
- Agent outputs should remain schema-validated and machine-readable before core acts on them.
- Tool capabilities should stay injectable so Phase 2+ can replace demo agents and stubs without rewriting coordinator logic.
