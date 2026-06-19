# Dev Assistant

Dev Assistant is a local-first multi-agent development assistant. The goal is to coordinate focused agents for coding, review, testing, architecture feedback, and technical debt tracking while keeping repository access, command execution, and model routing explicit.

## Current Status

This repository is in Phase 0: foundation. The first deliverable is a TypeScript monorepo with a CLI, shared config schema, structured logging, and a local data directory convention.

## Local-First Security Model

- Source code stays local by default.
- The default runtime mode is `local-only`.
- Shell commands must be allowlisted in config before future agents can run them.
- File edits and risky commands should require human approval.
- Logs are structured so agent actions can be audited.
- Local state lives in `.dev-assistant/`, which is ignored except for a placeholder file.

## Workspace Layout

- `apps/cli`: command-line entrypoint.
- `apps/vscode-extension`: placeholder package for the planned VS Code extension.
- `packages/shared`: shared schemas, config loading, logging, and data directory helpers.
- `packages/core`: planned orchestration engine.
- `packages/agents`: planned role definitions and agent contracts.
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
pnpm dev -- config
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
pnpm check
pnpm typecheck
pnpm test
```
