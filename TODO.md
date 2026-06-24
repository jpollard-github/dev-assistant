# Multi-Agent Development Assistant TODO

## Source Of Truth

This file is the planning source of truth for the repository.

- Use this file for roadmap, phase checklists, milestones, MVP definition of done, key decisions, status notes, and open questions.
- Keep `README.md` focused on project overview, setup, usage, and current caveats.
- Do not create a separate progress tracker unless there is a strong reason and it is linked here.

## Current Status

Current phase: Phase 3 complete, Phase 4 next.

What is implemented today:

- Phase 0 foundation is in place.
- The repo has a deterministic orchestrator flow and a minimal CLI `run` command.
- Task lifecycle events, SQLite-backed event history, structured logging, approval checkpoints, agent output schemas, budget enforcement, and prompt snapshots are implemented.
- Phase 2 now includes a provider interface, an Ollama backend, model capability metadata, optional hosted fallback support, and model-backed role handlers for the fixed four-role baseline.
- The local model path has been validated in this repo with `qwen2.5:3b` and `qwen2.5-coder:7b`.
- Phase 3 now includes repo, git, shell, test, and memory capability servers, agent permission profiles, and integration tests for every server.
- The CLI task flow now uses the real allowlisted shell execution path for configured test commands.
- Patch application is still a no-op, so the assistant is not yet MVP-useful.

What that means for MVP:

- The project is a strong scaffold, but not yet at the "real bug-fix assistant" stage.
- The biggest remaining unlocks are real patch application and richer role behavior on top of the new capability servers.

## Implemented Decisions

- Use `pnpm` workspaces for the monorepo.
- Use a CLI-first architecture before building the VS Code extension.
- Use TypeScript strict mode across all packages.
- Use `apps/*` and `packages/*` workspace boundaries.
- Include a placeholder VS Code extension package now, but keep implementation deferred until the CLI orchestration is useful.
- Keep the default runtime mode `local-only`.
- Use Ollama as the default local model provider in examples because it is simple to run locally.
- Use `qwen2.5-coder:7b` as the example default model name; this is configurable and not a hard requirement.
- Use `.dev-assistant/` as the local state directory convention.
- Store only a placeholder file in `.dev-assistant/`; generated state remains ignored by git.
- Start with a lightweight in-repo structured logger instead of adding a runtime logging dependency.
- Validate config shape in shared TypeScript code before later wiring in richer agent workflows.
- Run the CLI from built JavaScript for now because the `tsx` development runner opens an IPC pipe that is restricted in this sandboxed environment.
- Keep task budget defaults in orchestration code for now, but design the API so later phases can add optional config overrides.
- Keep the fixed coordinator -> coder -> reviewer -> test-runner sequence through the first real-model integration baseline, then revisit dynamic role selection later.
- Use separate capability-specific local servers for repo, git, shell, test, and memory concerns in the first MCP implementation.

## Open Questions

- Confirm whether `qwen2.5-coder:7b` should remain the default example model or be replaced with another local model.
- Decide whether the first real patch-application path should be unified diff based, structured file-operation based, or support both from the start.

## Product Thesis

Build a local-first development assistant that coordinates specialized agents for coding, review, testing, architecture feedback, and technical debt tracking. The system should feel like a senior engineering team embedded in VS Code, with clear handoffs, auditable decisions, and strong guardrails around file edits and tool execution.

## Guiding Principles

- Keep the first version local, inspectable, and boring where possible.
- Treat agents as role-specific workers with explicit inputs, outputs, permissions, and evaluation criteria.
- Prefer small, reviewable patches over large autonomous rewrites.
- Make every agent action traceable: prompt, context, tools used, files changed, tests run, and final rationale.
- Use MCP servers as capability boundaries, not as a dumping ground for all logic.
- Assume local LLMs will be slower and less reliable than hosted frontier models; design around incremental workflows, retries, and human approval.
- Build a useful single-user tool before designing for teams.

## Recommended Initial Scope

The MVP should support one local repository and one active task at a time.

Agents:

- Coordinator: decomposes tasks, assigns work, manages shared state, and asks the user for approval when needed.
- Coder: proposes and applies small implementation patches.
- Reviewer: inspects diffs for bugs, maintainability risks, and missing edge cases.
- Test Writer: adds or updates focused tests.
- Test Runner: executes project test commands and summarizes failures.
- Technical Debt Tracker: records follow-up issues in a local debt log.

Interfaces:

- CLI first for faster iteration.
- VS Code extension second, once orchestration semantics are stable.
- MCP servers for filesystem-safe repo access, shell command execution, git inspection, test running, and optional issue tracking.

## Architecture Recommendation

Use a TypeScript monorepo with clear package boundaries:

- `apps/cli`: local command-line interface.
- `apps/vscode-extension`: VS Code integration.
- `packages/core`: orchestration engine, task graph, event model, agent contracts.
- `packages/agents`: role definitions, prompts, tool policies, agent-specific output schemas.
- `packages/mcp-servers`: local MCP servers for repo, shell, git, tests, and memory.
- `packages/llm`: local model adapters and optional hosted model adapters.
- `packages/evals`: benchmark tasks, regression suites, scoring helpers.
- `packages/shared`: shared schemas, logging utilities, config loading.

Recommended stack:

- TypeScript with strict mode.
- pnpm workspaces or npm workspaces.
- Zod for schema validation.
- SQLite for local durable state.
- Drizzle or Kysely for database access.
- Model Context Protocol SDK for MCP servers.
- VS Code Extension API for editor integration.
- Vitest for unit tests.
- Playwright only if the extension or web UI needs end-to-end coverage.
- Ollama, LM Studio, llama.cpp, or vLLM for local model backends.

## Phase 0: Foundation

- [x] Create the monorepo structure.
- [x] Add TypeScript, linting, formatting, and test tooling.
- [x] Define project configuration files:
  - [x] `package.json`
  - [x] `pnpm-workspace.yaml` or equivalent workspace config
  - [x] `tsconfig.base.json`
  - [x] `.gitignore`
  - [x] `.env.example`
- [x] Add a root README explaining the local-first goal and security model.
- [x] Add a simple CLI entrypoint that can print version and config.
- [x] Define the first local config format:
  - [x] repo path
  - [x] model provider
  - [x] model name
  - [x] allowed shell commands
  - [x] test commands
  - [x] approval policy
- [x] Add structured logging from the beginning.
- [x] Add a local data directory convention, such as `.dev-assistant/`.

## Phase 1: Core Orchestrator

- [x] Define the task lifecycle:
  - [x] created
  - [x] planned
  - [x] assigned
  - [x] patch proposed
  - [x] patch applied
  - [x] reviewed
  - [x] tested
  - [x] completed
  - [x] blocked
- [x] Implement a typed event bus for agent messages and tool results.
- [x] Implement a coordinator that can run one task through a deterministic sequence.
- [x] Store task events in SQLite.
- [x] Add JSON schemas for all agent outputs.
- [x] Add retry behavior for invalid agent output.
- [x] Add a maximum budget per task:
  - [x] max model calls
  - [x] max shell commands
  - [x] max changed files
  - [x] max runtime
- [x] Add human approval checkpoints before file edits and non-allowlisted commands.

## Questions Before Phase 2

- [x] Decide whether task budget defaults should stay in orchestration code or move into the persisted user config schema.
Decision: Keep them in orchestration code for now, but design the API so Phase 2 or 3 can add optional config overrides later. This keeps defaults stable while product semantics are still moving without blocking future user-configurable budgets.
- [x] Decide whether the coordinator should keep the current fixed four-role sequence or move to dynamic role selection once real model adapters are added.
Decision: Keep the fixed four-role sequence through Phase 2, then introduce dynamic role selection only after the model adapter path is stable and there are enough traces to judge what should be optional. This preserves a controlled baseline before adding smarter routing.

## Phase 2: Local LLM Adapter

- [x] Implement a provider interface:
  - [x] `generateText`
  - [x] `generateStructured`
  - [x] optional streaming
  - [x] token accounting when available
- [x] Add one local backend first, probably Ollama for ease of setup.
- [x] Add model capability metadata:
  - [x] context window
  - [x] tool-use support
  - [x] structured-output reliability
  - [x] recommended roles
- [x] Add timeouts and cancellation.
- [x] Add prompt snapshots to task logs.
- [x] Design the provider/orchestration API so task budgets can gain optional config overrides later without moving default limits out of orchestration code yet.
- [x] Keep the fixed coordinator -> coder -> reviewer -> test-runner sequence as the baseline flow while integrating real model adapters.
- [x] Add optional hosted fallback support only after local workflows work.
- [x] Test with at least two model sizes:
  - [x] small fast model for classification and summaries
  - [x] stronger code model for implementation and review

## Phase 3: MCP Servers

This phase replaces the current stubbed shell/test execution path with real tool-backed capability servers.

- [x] Build a repo MCP server:
  - [x] list files
  - [x] read files
  - [x] search with ripgrep
  - [x] inspect file metadata
- [x] Build a git MCP server:
  - [x] status
  - [x] diff
  - [x] log
  - [x] current branch
- [x] Build a shell MCP server:
  - [x] allowlisted commands only
  - [x] timeout support
  - [x] output truncation
  - [x] clear escalation flow
- [x] Build a test MCP server:
  - [x] discover package manager
  - [x] run configured test commands
  - [x] parse common test output
- [x] Build a memory MCP server:
  - [x] task history
  - [x] repository facts
  - [x] debt log
  - [x] recurring failure patterns
- [x] Add permission profiles for each agent.
- [x] Add integration tests for every MCP server.

## Phase 4: Agent Roles

- [ ] Coordinator agent:
  - [ ] creates a short plan
  - [ ] keeps the fixed four-role sequence through the initial real-model integration baseline
  - [ ] enforces budgets and approvals
- [ ] Coder agent:
  - [ ] reads local context
  - [ ] proposes a focused change
  - [ ] explains risk and expected tests
- [ ] Reviewer agent:
  - [ ] reviews only the actual diff
  - [ ] prioritizes correctness and regressions
  - [ ] emits findings with file and line references
- [ ] Test Writer agent:
  - [ ] identifies missing coverage
  - [ ] adds focused tests
  - [ ] avoids broad snapshot churn
- [ ] Architecture Review agent:
  - [ ] checks boundaries, coupling, dependency direction, and migration risk
  - [ ] produces recommendations, not automatic rewrites
- [ ] Technical Debt agent:
  - [ ] records debt items in `.dev-assistant/debt.md` or SQLite
  - [ ] links each item to files and task history
  - [ ] distinguishes must-fix, should-fix, and nice-to-have

## Post-Phase 4 Follow-Up

- [ ] Introduce dynamic role selection only after the fixed-sequence baseline has enough task traces to justify which roles should become optional.

## Phase 5: Patch Workflow

This phase replaces the current no-op patch applier with a real, controlled patch workflow.

- [ ] Represent proposed edits as unified diffs or structured file operations.
- [ ] Validate patches before applying.
- [ ] Reject patches that touch files outside the configured repo.
- [ ] Show a summary before applying changes.
- [ ] Apply patches through a controlled patch service.
- [ ] Re-read changed files after patching.
- [ ] Run formatting when configured.
- [ ] Run tests after implementation and test edits.
- [ ] Ask Reviewer to inspect the final diff.
- [ ] Require the Coordinator to produce a final task report.

## Phase 6: CLI Experience

- [ ] Add `dev-assistant init`.
- [ ] Add `dev-assistant run "task description"`.
- [ ] Add `dev-assistant review`.
- [ ] Add `dev-assistant test`.
- [ ] Add `dev-assistant debt list`.
- [ ] Add `dev-assistant debt add`.
- [ ] Add `dev-assistant history`.
- [ ] Add `dev-assistant config doctor`.
- [ ] If budget overrides are exposed later, add them as optional advanced config rather than replacing orchestration-owned defaults.
- [ ] Support interactive approvals.
- [ ] Support a dry-run mode.
- [ ] Support machine-readable JSON output for automation.

## Phase 7: VS Code Extension

- [ ] Create a VS Code extension package.
- [ ] Add a sidebar for active tasks.
- [ ] Add commands:
  - [ ] Start assistant task
  - [ ] Review current diff
  - [ ] Generate tests for current file
  - [ ] Explain technical debt
  - [ ] Show assistant history
- [ ] Display agent events as a timeline.
- [ ] Show proposed patches in VS Code's native diff UI.
- [ ] Add approval buttons for applying edits and running commands.
- [ ] Support task cancellation.
- [ ] Add workspace trust checks.
- [ ] Avoid collecting source code telemetry by default.

## Phase 8: Evaluation System

- [ ] Create a set of small local benchmark repos or fixtures.
- [ ] Add task categories:
  - [ ] bug fix
  - [ ] feature addition
  - [ ] refactor
  - [ ] test generation
  - [ ] review-only
  - [ ] architecture critique
- [ ] Score outcomes:
  - [ ] builds successfully
  - [ ] tests pass
  - [ ] minimal changed files
  - [ ] reviewer catches seeded bugs
  - [ ] no forbidden file access
  - [ ] useful final summary
- [ ] Run evals against multiple local models.
- [ ] Track regression results over time.
- [ ] Add a small golden-output suite for structured responses.

## Phase 9: Security And Safety

- [ ] Default to read-only analysis until the user approves edits.
- [ ] Sandbox shell execution as much as the host OS allows.
- [ ] Maintain a command allowlist.
- [ ] Block network access unless explicitly enabled.
- [ ] Prevent agents from reading secrets by default.
- [ ] Redact secrets in logs.
- [ ] Never send code to hosted models unless the user opts in.
- [ ] Add clear provenance to all generated code.
- [ ] Add a panic button to cancel tasks and stop subprocesses.
- [ ] Document threat models:
  - [ ] prompt injection in repo files
  - [ ] malicious package scripts
  - [ ] secret exfiltration
  - [ ] accidental destructive edits
  - [ ] runaway token or compute usage

## Phase 10: Technical Debt Tracking

- [ ] Define a debt item schema:
  - [ ] title
  - [ ] severity
  - [ ] files
  - [ ] rationale
  - [ ] recommended fix
  - [ ] first seen task
  - [ ] status
- [ ] Auto-create debt candidates from reviewer and architecture findings.
- [ ] Require user confirmation before adding noisy debt items.
- [ ] Add duplicate detection.
- [ ] Add debt aging and priority sorting.
- [ ] Add commands to resolve, defer, and export debt.
- [ ] Optionally sync debt to GitHub Issues later.

## Phase 11: Hosted Model Option

- [ ] Add hosted model providers behind an explicit opt-in.
- [ ] Add per-provider cost estimation.
- [ ] Add repository-level privacy settings.
- [ ] Allow role-specific routing:
  - [ ] local model for search, summaries, and debt tracking
  - [ ] stronger hosted model for difficult coding tasks
  - [ ] local or hosted reviewer depending on privacy needs
- [ ] Show estimated cost before starting a task.
- [ ] Log actual token usage when provider APIs return it.

## Phase 12: Packaging And Distribution

- [ ] Package the CLI.
- [ ] Package the VS Code extension.
- [ ] Add install docs for local model runtimes.
- [ ] Add first-run diagnostics.
- [ ] Add example workflows.
- [ ] Add upgrade and migration logic for local SQLite state.
- [ ] Add crash reporting only as opt-in.

## Estimated Build Effort

For a solo experienced TypeScript developer:

- Prototype CLI with one local model and simple agents: 3 to 6 weeks.
- Useful MVP with patching, tests, review, and local state: 2 to 4 months.
- Polished VS Code extension and robust MCP servers: 4 to 8 months.
- Production-grade reliability, evals, security hardening, docs, and packaging: 9 to 18 months.

For a small team of 2 to 4 engineers:

- Prototype: 2 to 4 weeks.
- Useful MVP: 6 to 10 weeks.
- Strong beta: 4 to 6 months.
- Mature product: 6 to 12 months.

The hardest parts will not be writing the agents. The hard parts will be reliability, context selection, permissioning, patch quality, local model latency, and making failures understandable.

## Estimated Build Cost

Assuming US-based contract or opportunity-cost rates:

- Solo prototype: $15,000 to $60,000.
- Solo MVP: $60,000 to $180,000.
- Small-team beta: $200,000 to $600,000.
- Mature product: $600,000 to $1,500,000+.

Lower-cost self-build assumptions:

- If this is a learning project and you value your own time separately, cash cost can stay under $1,000 to $5,000 for the first few months.
- Main cash expenses would be hardware upgrades, occasional hosted model usage, test devices, and marketplace or signing fees.

## Estimated Maintenance Cost

Monthly maintenance after MVP:

- Solo personal project: $100 to $1,000 per month in cash costs, plus 10 to 30 hours of upkeep.
- Serious open-source project: $1,000 to $5,000 per month, plus 0.25 to 1 full-time engineer.
- Commercial product: $10,000 to $75,000+ per month depending on support, hosted services, security review, CI usage, and release cadence.

Maintenance work will include:

- Updating model adapters.
- Updating MCP SDK usage.
- Tracking VS Code API changes.
- Fixing prompt regressions.
- Improving evals.
- Hardening sandboxing.
- Supporting new package managers and test frameworks.
- Handling bug reports from different operating systems and repo layouts.

## Estimated Usage Cost

Local-only usage:

- Model API cost: $0.
- Electricity: usually $2 to $30 per month for casual use, more for heavy GPU use.
- Hardware: $0 if you already have a capable machine; $1,500 to $4,000+ for a strong local development machine; $3,000 to $8,000+ for a serious local GPU workstation.
- Latency cost: local models may be slower, especially for multi-agent workflows.

Hosted or hybrid usage:

- Light personal use: $5 to $50 per month.
- Heavy personal use: $50 to $300 per month.
- Small team: $300 to $3,000 per month.
- Larger team or CI-integrated agent workflows: $3,000 to $25,000+ per month.

Cost drivers:

- Number of agent turns per task.
- Context size.
- Whether every role uses a strong model.
- Test and build frequency.
- Whether code is sent to hosted providers.
- Number of repositories and users.

## Recommended Cost Controls

- [ ] Use cheaper local models for planning, summarization, and debt tracking.
- [ ] Use stronger models only for coding and review.
- [ ] Cache repository summaries.
- [ ] Limit context to files proven relevant by search.
- [ ] Cap model calls per task.
- [ ] Cap patch size.
- [ ] Run narrow tests before full suites.
- [ ] Estimate cost before hosted calls.
- [ ] Store per-task cost and runtime metrics.
- [ ] Add a "local-only" mode that hard-blocks hosted providers.

## Major Risks

- Local models may produce plausible but incorrect code.
- Multi-agent loops can amplify mistakes if agents trust each other too much.
- Prompt injection from repository content can manipulate tool use.
- Shell command execution can be dangerous without strict policies.
- VS Code UX can become noisy if every agent emits too much detail.
- Technical debt tracking can become a junk drawer unless deduplicated and prioritized.
- Architecture review can sound impressive while being too generic.
- Maintaining compatibility across many repo types can become a large support burden.

## Risk Mitigations

- [ ] Keep humans in the loop for edits and risky commands.
- [ ] Make reviewer agents adversarial and diff-focused.
- [ ] Use structured outputs and validate them.
- [ ] Keep task scope small.
- [ ] Build evals early.
- [ ] Keep logs inspectable.
- [ ] Prefer deterministic orchestration over open-ended agent chats.
- [ ] Add permissions per agent.
- [ ] Separate recommendations from automatic actions.
- [ ] Measure usefulness, not just model fluency.

## Suggested First Milestone

Build this first:

- [x] CLI command: `dev-assistant run "fix this bug"`
- [x] One Coordinator agent.
- [x] One Coder agent.
- [x] One Reviewer agent.
- [x] Repo search and file read tools.
- [x] Git diff inspection.
- [x] Patch proposal.
- [x] Human approval before patch apply.
- [x] Configured test command.
- [x] Final summary with changed files, test results, and reviewer findings.

Do not build the VS Code extension until this workflow feels useful from the CLI.

## Suggested Second Milestone

Add:

- [ ] Test Writer agent.
- [ ] Technical Debt agent.
- [x] SQLite event history.
- [ ] Debt log.
- [ ] Evaluation fixtures.
- [ ] Role-specific local model routing.

## Suggested Third Milestone

Add:

- [ ] VS Code sidebar.
- [ ] Native diff approval.
- [ ] Task timeline.
- [ ] Workspace trust integration.
- [ ] Better cancellation and command controls.

## Definition Of Done For MVP

- [ ] Can run against at least three real TypeScript repositories.
- [ ] Can complete small bug-fix tasks with human approval.
- [ ] Produces review findings that are sometimes genuinely useful.
- [ ] Can add or update tests for simple changes.
- [x] Runs configured tests and summarizes failures accurately.
- [ ] Tracks technical debt without excessive noise.
- [x] Keeps all source local unless hosted mode is explicitly enabled.
- [x] Has clear logs for every agent decision and tool call.
- [ ] Has basic evals that catch regressions.
- [ ] Has documentation good enough for another developer to install and try it.
