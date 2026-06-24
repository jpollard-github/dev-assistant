# Dev Assistant

Dev Assistant is a local-first multi-agent development assistant. The goal is to coordinate focused agents for coding, review, testing, architecture feedback, and technical debt tracking while keeping repository access, command execution, and model routing explicit.

## Current Status

This repository is in Phase 9: security and safety. The repo now includes a deterministic task runner, task lifecycle events, SQLite-backed task history, agent output schemas, prompt snapshots, an Ollama-backed structured-generation path for the fixed coordinator -> coder -> reviewer -> test-runner flow, optional hosted fallback support for hybrid mode, local repo/git/shell/test/memory capability servers, capability-backed advisory outputs for test writing, architecture review, and technical debt tracking, a real structured patch-application path with validation and final task reporting, a VS Code extension with task timeline and approvals, an eval package with benchmark fixtures/scoring/regression history, and security controls for secret-aware repo access, log redaction, hosted-code opt-in, provenance comments, and panic shutdown.

Roadmap, phase progress, milestones, MVP definition of done, and project decisions now live in [TODO.md](/Users/jasonp/repos/dev-assistant/TODO.md).

## Local-First Security Model

- Source code stays local by default.
- The default runtime mode is `local-only`.
- Shell commands must be allowlisted in config before future agents can run them.
- Shell network access is blocked unless the repo config explicitly enables it.
- Sensitive repository paths such as `.env` and key material are blocked by default.
- File edits and risky commands should require human approval.
- Logs are structured so agent actions can be audited.
- Logs redact common secret/token/private-key patterns before writing.
- Local state lives in `.dev-assistant/`, which is ignored except for a placeholder file.
- Phase 5 uses a real Ollama-backed model adapter, a real allowlisted shell/test execution path, capability-backed role prompts, and a controlled patch workflow that applies structured file operations inside the configured repo only.
- Hosted or hybrid model routing now requires explicit opt-in before repository code can be sent off-machine.

## Workspace Layout

- `apps/cli`: command-line entrypoint.
- `apps/vscode-extension`: VS Code extension with task sidebar, approvals, history, and review/debt/test commands.
- `packages/shared`: shared schemas, config loading, logging, and data directory helpers.
- `packages/core`: task orchestration engine, event bus, budgets, approvals, and SQLite event storage.
- `packages/agents`: role definitions and structured output schemas for coordinator, coder, reviewer, and test-runner flows.
- `packages/mcp-servers`: local repo, git, shell, test, and memory capability servers.
- `packages/agents`: schemas for primary and advisory agent outputs.
- `packages/llm`: local and optional hosted model adapters.
- `packages/evals`: evaluation fixtures, scoring helpers, regression tracking, and golden structured-output checks.

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

Install Ollama:

- macOS: download the `.dmg` from Ollama and drag the app into `Applications`.
- Linux: run `curl -fsSL https://ollama.com/install.sh | sh`
- Windows: download and run the Ollama installer.

Run the current CLI task flow:

```sh
corepack pnpm build
node apps/cli/dist/index.js run "describe the task"
```

Useful CLI commands:

```sh
# create a starter config file
node apps/cli/dist/index.js init

# inspect config health
node apps/cli/dist/index.js config doctor

# review the current git diff
node apps/cli/dist/index.js review

# run configured tests and summarize them
node apps/cli/dist/index.js test

# preview a task without applying edits
node apps/cli/dist/index.js run "describe the task" --dry-run

# inspect debt and history
node apps/cli/dist/index.js debt list
node apps/cli/dist/index.js history

# emergency stop for registered assistant subprocesses
node apps/cli/dist/index.js panic
node apps/cli/dist/index.js panic --clear

# emit machine-readable JSON
node apps/cli/dist/index.js review --json
```

Start Ollama and install a model:

```sh
ollama serve
ollama pull qwen2.5-coder:7b
```

On macOS and Windows, the desktop app can also run Ollama in the background. On Linux, `ollama serve` is the standard way to start the local server.

Useful Ollama commands:

```sh
# start the local server
ollama serve

# open the interactive menu
ollama

# run a model directly
ollama run qwen2.5-coder:7b

# download a model
ollama pull qwen2.5-coder:7b

# list downloaded models
ollama ls

# list running models
ollama ps

# stop a running model
ollama stop qwen2.5-coder:7b

# remove a downloaded model
ollama rm qwen2.5-coder:7b
```

Stopping Ollama:

- If you started it with `ollama serve`, stop it with `Ctrl+C` in that terminal.
- If you are using the macOS or Windows app, quit the Ollama app to stop the background service.

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
  "formatCommands": ["pnpm format -- src/index.ts"],
  "testCommands": ["pnpm test"],
  "approvalPolicy": "on-risky-action",
  "dataDir": ".dev-assistant",
  "mode": "local-only",
  "security": {
    "allowNetwork": false,
    "allowSecretAccess": false,
    "allowHostedCodeContext": false,
    "redactLogs": true,
    "requireProvenanceComments": true,
    "panicFile": ".dev-assistant/panic.json",
    "processRegistryFile": ".dev-assistant/processes.json"
  }
}
```

Optional hybrid fallback example:

```json
{
  "repoPath": ".",
  "model": {
    "provider": "ollama",
    "name": "qwen2.5-coder:7b"
  },
  "hosted": {
    "baseUrl": "https://api.openai.com/v1",
    "apiKeyEnvVar": "OPENAI_API_KEY"
  },
  "allowedShellCommands": [],
  "formatCommands": [],
  "testCommands": [],
  "approvalPolicy": "never",
  "dataDir": ".dev-assistant",
  "mode": "hybrid"
}
```

In `hybrid` mode, the assistant tries Ollama first and falls back to the hosted provider if the local model call fails. In `hosted` mode, set `"model.provider": "hosted"` and keep the `hosted` block populated.

Notes:

- Any command listed in `formatCommands` or `testCommands` should also appear in `allowedShellCommands`, because the shell/test path still enforces the allowlist.
- Commands like `history`, `debt list`, `debt add`, `config doctor`, and `test` do not require Ollama to be running.
- Commands like `run` and `review` still rely on the configured model provider.

## Development

```sh
corepack pnpm check
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

## Current Caveats

- `dev-assistant run` now uses the configured Ollama model for structured agent outputs, and it can optionally fall back to a hosted Chat Completions compatible endpoint in `hybrid` mode.
- Structured coder outputs now drive a real patch workflow with repo-bound validation, optional format commands, reviewer inspection of the final diff, and a final coordinator report.
- Configured allowlisted test commands now run through the real shell/test path.
- The CLI now supports `init`, `review`, `test`, `debt list`, `debt add`, `history`, `config doctor`, `--dry-run`, interactive approvals, and `--json` output.
- Advisory outputs now include test-writing recommendations, architecture review recommendations, and automatic technical debt entries written to `.dev-assistant/debt.md`.
- Reviewer findings are still inconsistent about file-and-line references on local models.
- The Test Writer is still advisory only; it recommends tests but does not apply them yet.
- Technical debt logging is still noisy and needs deduplication before it is MVP-done.
- The eval package provides baseline scoring and regression tracking, but it still needs to be exercised regularly against real local model runs to tune prompt quality.
- Shell execution is safer than before, but it still runs on the host OS rather than inside a disposable VM/container sandbox.
- Hosted fallback support is implemented and unit-tested, but it was not live-validated here because no hosted credentials were configured in this repo.
- A blocked task is currently reported in the JSON result, but the CLI still exits with code `0` unless a command-level exception is thrown.
