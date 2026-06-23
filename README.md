# Dev Assistant

Dev Assistant is a local-first multi-agent development assistant. The goal is to coordinate focused agents for coding, review, testing, architecture feedback, and technical debt tracking while keeping repository access, command execution, and model routing explicit.

## Current Status

This repository is in Phase 1: core orchestrator. The repo now includes a deterministic task runner, task lifecycle events, SQLite-backed task history, agent output schemas, and a minimal CLI `run` command on top of the Phase 0 foundation.

## Local-First Security Model

- Source code stays local by default.
- The default runtime mode is `local-only`.
- Shell commands must be allowlisted in config before future agents can run them.
- File edits and risky commands should require human approval.
- Logs are structured so agent actions can be audited.
- Local state lives in `.dev-assistant/`, which is ignored except for a placeholder file.
- Phase 1 intentionally uses safe default stubs for patch application and shell execution until later phases wire in real tool services.

## Workspace Layout

- `apps/cli`: command-line entrypoint.
- `apps/vscode-extension`: placeholder package for the planned VS Code extension.
- `packages/shared`: shared schemas, config loading, logging, and data directory helpers.
- `packages/core`: task orchestration engine, event bus, budgets, approvals, and SQLite event storage.
- `packages/agents`: role definitions and structured output schemas for coordinator, coder, reviewer, and test-runner flows.
- `packages/mcp-servers`: planned MCP capability servers.
- `packages/llm`: planned local and optional hosted model adapters.
- `packages/evals`: planned evaluation fixtures and scoring helpers.

## Getting Started

Install dependencies with pnpm:

```sh
corepack enable
corepack pnpm install
```

Print the CLI version:

```sh
pnpm build
pnpm dev -- version
```

Print the resolved config:

```sh
corepack pnpm dev -- config
```

Run the Phase 1 orchestration flow:

```sh
corepack pnpm build
node apps/cli/dist/index.js run "describe the task"
```

## Configuration

Create `dev-assistant.config.json` at the repository root when you want to override defaults:

```json
{
  "repoPath": ".",
  "model": {
    "provider": "ollama",
    "name": "qwen2.5-coder:7b"
  },
  "allowedShellCommands": ["pnpm test", "pnpm typecheck"],
  "testCommands": ["pnpm test"],
  "approvalPolicy": "on-risky-action",
  "dataDir": ".dev-assistant",
  "mode": "local-only"
}
```

## Development

```sh
corepack pnpm check
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

## Current Caveats

- `dev-assistant run` currently validates orchestration, persistence, and approval flow, but the default patch applier is a no-op and the default shell runner is stubbed.
- A blocked task is currently reported in the JSON result, but the CLI does not yet turn that into a non-zero process exit code.
