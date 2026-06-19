# Decisions And Progress

This file records project progress against `TODO.md` and the decisions made while implementing each phase.

## Phase 0: Foundation

Status: in progress.

Decisions:

- Use `pnpm` workspaces for the monorepo.
- Use a CLI-first architecture before building the VS Code extension.
- Use TypeScript strict mode across all packages.
- Use `apps/*` and `packages/*` workspace boundaries.
- Include a placeholder VS Code extension package now, but keep the implementation deferred until the CLI orchestration is useful.
- Keep the default runtime mode `local-only`.
- Use Ollama as the default local model provider in examples because it is simple to run locally.
- Use `qwen2.5-coder:7b` as the example default model name; this is configurable and not a hard requirement.
- Use `.dev-assistant/` as the local state directory convention.
- Store only a `.gitkeep` file in `.dev-assistant/`; generated state remains ignored by git.
- Start with a lightweight in-repo structured logger instead of adding a runtime logging dependency.
- Validate config shape in shared TypeScript code before later wiring in richer agent workflows.
- Run the CLI from built JavaScript for now because the `tsx` development runner opens an IPC pipe that is restricted in this sandboxed environment.

Progress:

- [x] Created monorepo structure.
- [x] Added TypeScript, linting, formatting, and test tooling configuration.
- [x] Added root project configuration files.
- [x] Added root README with the local-first goal and security model.
- [x] Added a simple CLI entrypoint that can print version and config.
- [x] Defined the first local config format.
- [x] Added structured logging.
- [x] Added `.dev-assistant/` local data directory convention.

Open questions:

- Confirm whether `qwen2.5-coder:7b` should remain the default example model or be replaced with another local model.
- Confirm whether the first MCP implementation should use separate servers per capability or one development server with separate tools.
