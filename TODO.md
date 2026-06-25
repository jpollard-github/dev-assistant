# Multi-Agent Development Assistant TODO

## Source Of Truth

This file is the planning source of truth for the repository.

- Use this file for roadmap, phase checklists, milestones, MVP definition of done, key decisions, status notes, and open questions.
- Keep `README.md` focused on project overview, setup, usage, and current caveats.
- Do not create a separate progress tracker unless there is a strong reason and it is linked here.

## Current Status

Current phase: Phase 15 MVP closure is in progress, with Phase 4 reviewer/test-writer closure work and two deeper Phase 13 hardening items still open.

What is implemented today:

- Phase 0 foundation is in place.
- The repo has a deterministic orchestrator flow and a minimal CLI `run` command.
- Task lifecycle events, SQLite-backed event history, structured logging, approval checkpoints, agent output schemas, budget enforcement, and prompt snapshots are implemented.
- Phase 2 now includes a provider interface, an Ollama backend, model capability metadata, optional hosted fallback support, and model-backed role handlers for the fixed four-role baseline.
- The local model path has been validated in this repo with `qwen2.5:3b` and `qwen2.5-coder:7b`.
- Phase 3 now includes repo, git, shell, test, and memory capability servers, agent permission profiles, and integration tests for every server.
- The CLI task flow now uses the real allowlisted shell execution path for configured test commands.
- Phase 4 now includes capability-backed coordinator/coder/reviewer/test-runner prompts, standalone advisory roles for test writing, architecture review, and technical debt tracking, and automatic debt log recording to `.dev-assistant/debt.md`.
- Phase 5 now includes structured file operations from the coder, controlled patch application, repo-bound patch validation, optional formatting commands, final-diff review, and a coordinator final task report.
- The Phase 5 path was live-validated locally against a throwaway Git fixture using Ollama and `qwen2.5-coder:7b`.
- Phase 6 now includes `init`, `review`, `test`, `debt list`, `debt add`, `history`, `config doctor`, interactive approvals, dry-run support, and `--json` machine-readable output.
- The non-model CLI commands now work without requiring Ollama to be running.
- Phase 7 now includes a functional VS Code extension package with an activity-bar sidebar, active-task timeline, native diff previews for patch approvals, modal approval controls for edits and shell commands, task cancellation, workspace trust gating, and history/test/debt/review commands surfaced in the editor.
- The VS Code sidebar now favors a narrow layout by moving primary actions into a vertical welcome state plus a compact in-view Quick Actions section instead of long title-bar command labels.
- Phase 8 now includes benchmark fixtures across six task categories, fixture materialization helpers, outcome scoring for the planned MVP quality gates, a multi-model eval matrix runner, regression-history persistence, and a golden structured-output suite for agent/advisory schemas.
- Phase 9 now includes secret-aware repo access defaults, log redaction, network-disabled shell execution by default, hosted code-context opt-in requirements, provenance comments for generated code, panic mode for killing registered subprocesses, and a written threat model in `docs/security-threat-model.md`.
- Phase 10 now includes a structured debt item schema, duplicate detection, auto-created debt candidates from reviewer and architecture findings, noisy-item confirmation, aging/severity sorting, and CLI commands to list, resolve, defer, and export debt items.
- Phase 11 now includes repository privacy settings, role-specific local/hosted routing defaults and overrides, hosted cost estimation before runs, actual token-usage/cost reporting in CLI outputs, and mirrored routing support in the VS Code extension.
- Phase 12 now includes distributable CLI and VS Code packaging metadata/scripts, install and workflow docs, a first-run `doctor` command, SQLite schema migration support, and opt-in local crash reporting.
- Phase 13 now includes hosted-routing secret preflight scans, explicit per-run acknowledgement for private repositories before hosted routing, crash-report retention and upload controls, binary/large-file quarantine for agent context, write-scope and branch-guard controls for patch application, tamper-evident task-event checksums, and shell policy controls for dependency installs and package scripts.
- A first local-only pilot pass was run against disposable clones of `personal`, `mood-switcher`, and `spotify-export`; see `docs/pilot-validation-2026-06-24.md`.
- A second local-only reviewer rerun against the same seeded pilot regressions now produces file-and-line citations in all three repos, and the CLI/VSIX reviewer path now enriches missing citations from diff context.
- The test-writer advisory path now supports concrete file operations and command suggestions, and CLI/VSIX runs can merge focused test-file edits back into coder proposals.
- Coder context selection and proposal sanitization now exclude assistant-control paths like `.dev-assistant/`, `.git/`, and `dev-assistant.config.json` unless the user explicitly asks for them.

What that means for MVP:

- The project has crossed into an early MVP-capable state for small, low-risk tasks in both the CLI and VS Code.
- The biggest remaining unlocks are stable end-to-end real-repo coding runs, broader reviewer precision validation beyond seeded regressions, and real test-writing/edit application.
- Security posture is now materially stronger for local-first and hybrid use, with preflight hosted-export checks and tamper-evident local task history now in place.
- The biggest remaining security gaps are disposable execution isolation for test/format flows, stronger supply-chain signing for release artifacts, and the still-open Phase 4 reviewer/test-writer quality work.
- Recommendation: start supervised internal usage now from both the CLI and VS Code extension for small, reviewable tasks in trusted TypeScript repositories, but do not yet treat the reviewer or test-writer as a release gate and expect local-model flakiness to surface occasionally.

## Implemented Decisions

- Use `pnpm` workspaces for the monorepo.
- Use a CLI-first architecture before building the VS Code extension.
- Use TypeScript strict mode across all packages.
- Use `apps/*` and `packages/*` workspace boundaries.
- Use the live VS Code extension as the second interface layer now that the CLI orchestration is useful.
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

## Dependency Map

- Remaining Phase 4 reviewer precision work now has baseline eval coverage plus live citation enrichment, but still needs broader prompt/model tuning and usefulness checks on more varied diffs.
- Remaining Phase 4 Test Writer implementation now has evaluation coverage plus concrete test-file operations, but still needs reliable end-to-end author/apply validation in real repos.
- Technical debt tracking now has structured schema, deduplication, and confirmation flows; the main remaining follow-up is optional external sync and further quality tuning.
- The Post-Phase 4 dynamic role selection follow-up now has evaluation fixtures, regression traces, and Phase 11 routing controls to build on.

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

- [x] Coordinator agent:
  - [x] creates a short plan
  - [x] keeps the fixed four-role sequence through the initial real-model integration baseline
  - [x] enforces budgets and approvals
- [x] Coder agent:
  - [x] reads local context
  - [x] proposes a focused change
  - [x] explains risk and expected tests
- [x] Reviewer agent:
  - [x] reviews only the actual diff
  - [x] prioritizes correctness and regressions
  - [x] emits findings with file and line references
  Note: Phase 8 now adds baseline review-quality eval coverage, and CLI/VSIX review flows now enrich missing file/line metadata from diff context. Remaining work is live usefulness tuning, not the baseline citation path itself.
- [ ] Test Writer agent:
  - [x] identifies missing coverage
  - [ ] adds focused tests
  - [x] avoids broad snapshot churn
  Note: Phase 8 now adds test-generation eval coverage, and the advisory path can now return concrete test-file operations and commands. The remaining gap is reliable end-to-end authoring and application in real repos.
- [x] Architecture Review agent:
  - [x] checks boundaries, coupling, dependency direction, and migration risk
  - [x] produces recommendations, not automatic rewrites
- [x] Technical Debt agent:
  - [x] records debt items in `.dev-assistant/debt.md` or SQLite
  - [x] links each item to files and task history
  - [x] distinguishes must-fix, should-fix, and nice-to-have
  Note: Phase 10 now adds structured debt storage, duplicate detection, confirmation for noisy items, and lifecycle commands.

## Post-Phase 4 Follow-Up

- [ ] Introduce dynamic role selection only after the fixed-sequence baseline has enough task traces to justify which roles should become optional.
  Note: Phase 8 now provides starter evaluation data and regression traces, with Phase 11 role-specific routing likely informing the final design.

## Phase 5: Patch Workflow

This phase replaces the current no-op patch applier with a real, controlled patch workflow.

- [x] Represent proposed edits as unified diffs or structured file operations.
- [x] Validate patches before applying.
- [x] Reject patches that touch files outside the configured repo.
- [x] Show a summary before applying changes.
- [x] Apply patches through a controlled patch service.
- [x] Re-read changed files after patching.
- [x] Run formatting when configured.
- [x] Run tests after implementation and test edits.
- [x] Ask Reviewer to inspect the final diff.
- [x] Require the Coordinator to produce a final task report.

## Phase 6: CLI Experience

- [x] Add `dev-assistant init`.
- [x] Add `dev-assistant run "task description"`.
- [x] Add `dev-assistant review`.
- [x] Add `dev-assistant test`.
- [x] Add `dev-assistant debt list`.
- [x] Add `dev-assistant debt add`.
- [x] Add `dev-assistant history`.
- [x] Add `dev-assistant config doctor`.
- [ ] If budget overrides are exposed later, add them as optional advanced config rather than replacing orchestration-owned defaults.
  Note: this is a future config-tuning enhancement, not a blocker for Phase 6 completion.
  Recommended approach:
  - Keep `DEFAULT_TASK_BUDGET` in orchestration code as the baseline behavior.
  - Add an optional advanced config block later, such as `budgetOverrides`.
  - Merge user overrides onto orchestration defaults at runtime rather than moving default ownership into config.
  - Document the feature as advanced tuning, not a required setup step for normal users.
- [x] Support interactive approvals.
- [x] Support a dry-run mode.
- [x] Support machine-readable JSON output for automation.

## Phase 7: VS Code Extension

- [x] Create a VS Code extension package.
- [x] Add a sidebar for active tasks.
- [x] Add commands:
  - [x] Start assistant task
  - [x] Review current diff
  - [x] Generate tests for current file
  - [x] Explain technical debt
  - [x] Show assistant history
- [x] Display agent events as a timeline.
- [x] Show proposed patches in VS Code's native diff UI.
- [x] Add approval buttons for applying edits and running commands.
- [x] Support task cancellation.
- [x] Add workspace trust checks.
- [x] Avoid collecting source code telemetry by default.

## Phase 8: Evaluation System

- [x] Create a set of small local benchmark repos or fixtures.
- [x] Add task categories:
  - [x] bug fix
  - [x] feature addition
  - [x] refactor
  - [x] test generation
  - [x] review-only
  - [x] architecture critique
- [x] Score outcomes:
  - [x] builds successfully
  - [x] tests pass
  - [x] minimal changed files
  - [x] reviewer catches seeded bugs
  - [x] no forbidden file access
  - [x] useful final summary
- [x] Run evals against multiple local models.
- [x] Track regression results over time.
- [x] Add a small golden-output suite for structured responses.

## Phase 9: Security And Safety

- [x] Default to read-only analysis until the user approves edits.
- [x] Sandbox shell execution as much as the host OS allows.
- [x] Maintain a command allowlist.
- [x] Block network access unless explicitly enabled.
- [x] Prevent agents from reading secrets by default.
- [x] Redact secrets in logs.
- [x] Never send code to hosted models unless the user opts in.
- [x] Add clear provenance to all generated code.
- [x] Add a panic button to cancel tasks and stop subprocesses.
- [x] Document threat models:
  - [x] prompt injection in repo files
  - [x] malicious package scripts
  - [x] secret exfiltration
  - [x] accidental destructive edits
  - [x] runaway token or compute usage

## Phase 13: Advanced Security Hardening

- [x] Add preflight secret scanning before any hosted code export.
- [x] Require an explicit per-run acknowledgement before private-repo code is routed to hosted providers, even when config allows it.
- [x] Add retention limits and explicit upload controls for crash reports before any remote crash endpoint is supported.
- [x] Add binary-file and large-file quarantine rules for agent context gathering.
- [ ] Isolate test and format commands in disposable sandboxes or temp clones where possible.
- [x] Add per-file write scopes for assistant edits.
- [x] Add required-branch guards for assistant edits.
- [x] Add tamper-evident audit log checksums.
- [x] Add policy controls for dependency installation and package-script execution.
- [ ] Add true branch isolation or temp-clone execution for assistant edits.
- [ ] Add signed packaging and release verification for CLI and VS Code extension artifacts.

## Phase 14: Operational Security And Supply Chain

- [ ] Add release signing and verification workflows for published CLI tarballs and VS Code VSIX artifacts.
- [ ] Add dependency-vulnerability and lockfile-integrity checks to `doctor` or release validation.
- [ ] Add suspicious-file or prompt-injection heuristics for repository context selection.
- [ ] Add filesystem-permission checks for config, state, and crash-report directories on multi-user machines.
- [ ] Add exportable policy/audit attestations for hosted-routing acknowledgements and patch approvals.

## Phase 10: Technical Debt Tracking

- [x] Define a debt item schema:
  - [x] title
  - [x] severity
  - [x] files
  - [x] rationale
  - [x] recommended fix
  - [x] first seen task
  - [x] status
- [x] Auto-create debt candidates from reviewer and architecture findings.
- [x] Require user confirmation before adding noisy debt items.
- [x] Add duplicate detection.
- [x] Add debt aging and priority sorting.
- [x] Add commands to resolve, defer, and export debt.
- [ ] Optionally sync debt to GitHub Issues later.

## Phase 11: Hosted Model Option

- [x] Add hosted model providers behind an explicit opt-in.
- [x] Add per-provider cost estimation.
- [x] Add repository-level privacy settings.
- [x] Allow role-specific routing:
  - [x] local model for search, summaries, and debt tracking
  - [x] stronger hosted model for difficult coding tasks
  - [x] local or hosted reviewer depending on privacy needs
- [x] Show estimated cost before starting a task.
- [x] Log actual token usage when provider APIs return it.

## Phase 12: Packaging And Distribution

- [x] Package the CLI.
- [x] Package the VS Code extension.
- [x] Add install docs for local model runtimes.
- [x] Add first-run diagnostics.
- [x] Add example workflows.
- [x] Add upgrade and migration logic for local SQLite state.
- [x] Add crash reporting only as opt-in.

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

- [x] Use cheaper local models for planning, summarization, and debt tracking.
- [x] Use stronger models only for coding and review.
- [ ] Cache repository summaries.
- [ ] Limit context to files proven relevant by search.
- [x] Cap model calls per task.
- [x] Cap patch size.
- [ ] Run narrow tests before full suites.
- [x] Estimate cost before hosted calls.
- [x] Require explicit acknowledgement before private repos can route code to hosted providers.
- [ ] Store per-task cost and runtime metrics.
- [x] Add a "local-only" mode that hard-blocks hosted providers.

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

- [x] Keep humans in the loop for edits and risky commands.
- [x] Make reviewer agents adversarial and diff-focused.
- [x] Use structured outputs and validate them.
- [x] Keep task scope small.
- [x] Build evals early.
- [x] Keep logs inspectable.
- [x] Prefer deterministic orchestration over open-ended agent chats.
- [x] Add permissions per agent.
- [x] Separate recommendations from automatic actions.
- [x] Preflight-scan repositories for secret-like content before hosted routing.
- [x] Quarantine binary and oversized files from model context gathering.
- [x] Restrict assistant edits to configured write scopes and branch guards.
- [x] Keep local task-event history tamper-evident with checksums.
- [x] Measure usefulness, not just model fluency.

## Risk Review Snapshot

- Local models may produce plausible but incorrect code.
  Status: Partially met.
  Reason: approvals, tests, evals, and deterministic orchestration reduce damage, but the reviewer/test-writer quality bar is not yet high enough to trust unattended results.
- Multi-agent loops can amplify mistakes if agents trust each other too much.
  Status: Mostly met for the current product shape.
  Reason: the workflow remains deterministic and fixed-sequence, which avoids the worst loop behavior; revisit this risk before any dynamic-role rollout.
- Prompt injection from repository content can manipulate tool use.
  Status: Partially met.
  Reason: untrusted-content guidance, repo boundaries, secret blocking, and hosted preflight exist, but suspicious-text heuristics and stronger execution isolation are still missing.
- Shell command execution can be dangerous without strict policies.
  Status: Partially met.
  Reason: allowlists, network controls, package-script/dependency-install policy, and panic mode exist, but commands still execute on the host and temp-clone/disposable isolation is still open.
- VS Code UX can become noisy if every agent emits too much detail.
  Status: Partially met.
  Reason: the extension is usable, but real daily-use trials should drive event compression, wording cleanup, and approval UX tuning.
- Technical debt tracking can become a junk drawer unless deduplicated and prioritized.
  Status: Mostly met.
  Reason: schema, dedupe, confirmation, and lifecycle commands are implemented; the remaining work is quality tuning and optional external sync.
- Architecture review can sound impressive while being too generic.
  Status: Partially met.
  Reason: the advisory role exists, but it still needs live usefulness scoring in real repositories.
- Maintaining compatibility across many repo types can become a large support burden.
  Status: Not yet met.
  Reason: the product needs explicit pilot coverage across at least three real TypeScript repositories plus a compatibility matrix before this risk is considered under control.

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

- [x] Test Writer agent.
- [x] Technical Debt agent.
- [x] SQLite event history.
- [x] Debt log.
- [x] Evaluation fixtures.
- [x] Structured debt lifecycle commands and deduplication.
- [x] Role-specific local model routing.

## Suggested Third Milestone

Add:

- [x] VS Code sidebar.
- [x] Native diff approval.
- [x] Task timeline.
- [x] Workspace trust integration.
- [x] Better cancellation and command controls.

## Suggested Fourth Milestone

Add:

- [x] Secret-aware repo access defaults.
- [x] Network-disabled shell execution by default.
- [x] Hosted code-context opt-in.
- [x] Panic mode and subprocess termination.
- [x] Threat model documentation.

## Suggested Fifth Milestone

Add:

- [x] Structured debt schema and storage.
- [x] Duplicate detection and aging-based sorting.
- [x] Reviewer and architecture debt candidates.
- [x] Noisy-item confirmation flow.
- [x] Resolve, defer, and export debt commands.

## Suggested Sixth Milestone

Add:

- [x] First-run `doctor` diagnostics.
- [x] SQLite schema migration support for task history.
- [x] CLI tarball packaging metadata.
- [x] VS Code VSIX packaging metadata.
- [x] Local runtime setup and example workflow docs.
- [x] Crash reporting that stays opt-in.

## Suggested Seventh Milestone

Add:

- [x] Hosted-routing secret preflight scanning.
- [x] Private-repo hosted acknowledgement prompts in CLI and VS Code.
- [x] Crash-report retention caps and explicit upload policy controls.
- [x] Binary and oversized file quarantine for repo context.
- [x] Assistant write scopes and required-branch patch guards.
- [x] Tamper-evident task-event checksums.
- [x] Dependency-install and package-script shell policy controls.
- [ ] Disposable temp-clone or sandbox execution for test and format commands.
- [ ] Signed release verification for packaged artifacts.

## Phase 15: MVP Closure And Internal Adoption

This phase consolidates every still-open item from prior phases, milestones, cost controls, and MVP criteria into one go/no-go plan for daily CLI and VS Code usage.

- [ ] Validate the assistant on at least three real TypeScript repositories.
  Status: MVP blocker.
  Prerequisites: choose pilot repos, keep configs checked in or documented, capture run logs and outcome notes.
  Notes: this closes the open MVP item and is the main compatibility-risk reducer.
  Current evidence:
  - A first local-only pilot was completed on 2026-06-24 against `personal`, `mood-switcher`, and `spotify-export` using disposable temp clones.
  - `personal` and `mood-switcher` are strong TypeScript representatives.
  - A later third TypeScript-heavy pilot was completed against a disposable working-copy of `dev-assistant` itself because a plain git clone did not have a ready dependency bootstrap.
  - The stronger TypeScript trio is now `personal`, `mood-switcher`, and `dev-assistant`.
  - `spotify-export` remains useful edge-case coverage for local-data/script repos.
  - See `docs/pilot-validation-2026-06-24.md`.
- [ ] Make reviewer findings reliably actionable, including file-and-line references and fewer generic comments.
  Status: MVP blocker.
  Prerequisites: prompt tuning, citation-format enforcement, eval expansion for seeded review failures, live-run trace review.
  Notes: consolidates the remaining Phase 4 reviewer work and the open MVP review-quality item.
  Current evidence:
  - Pilot review runs caught seeded regressions in all three repos.
  - A same-day second-pass reviewer rerun on fresh temp clones of `personal`, `mood-switcher`, and `spotify-export` produced correct findings with file and line references in all three repos.
  - CLI and VSIX review flows now enrich missing file/line metadata from final diff context when the model omits it.
  - Remaining gap: broader usefulness/precision validation on more varied diffs, plus resilience when the local model runtime is flaky.
- [ ] Enable the Test Writer to author and apply focused tests for simple changes.
  Status: MVP blocker.
  Prerequisites: reuse the existing patch workflow, define test-writer write permissions, add evals for authored tests, verify narrow test execution.
  Notes: consolidates the remaining Phase 4 test-writer work and the open MVP test-authoring item.
  Current evidence:
  - The advisory test-writer now supports concrete `files`, `operations`, and `commands`, and CLI/VSIX runs can merge focused test-file edits into coder proposals.
  - Coder proposals are now sanitized to remove assistant-control files that were not explicitly requested, which closes one real blocker found in pilot reruns.
  - The end-to-end real-repo proof is still open: a fresh `personal` rerun intended to verify this hit a local Ollama `fetch failed` runtime error before the full flow could complete.
- [ ] Add narrow-test planning before full-suite execution where possible.
  Status: Strong MVP improvement.
  Prerequisites: file-to-test heuristics, repo-specific test mapping, CLI/VSIX surfacing for the selected narrow scope.
  Notes: closes an open cost-control item and reduces runtime/cost for daily use.
- [ ] Limit model context to files proven relevant by search, diff, or user selection.
  Status: Strong MVP improvement.
  Prerequisites: context-ranking logic, prompt/context plumbing, eval checks for missed context.
  Notes: closes an open cost-control item and helps both quality and cost.
  Current evidence:
  - Candidate-file selection now prioritizes prompt-mentioned files and changed files, and excludes assistant-control paths.
  - Remaining gap: better ranking and pruning beyond these baseline heuristics.
- [ ] Store per-task cost and runtime metrics in local state and surface them in CLI/VSIX history.
  Status: Strong MVP improvement.
  Prerequisites: task-store schema extension, report formatting, JSON output updates.
  Notes: closes the open cost-control item and gives us operational feedback for pilots.
- [ ] Add automated smoke tests for packaged CLI execution against external working directories.
  Status: MVP blocker.
  Prerequisites: package-safe runtime imports, workspace-independent launch path, test harness that runs the built CLI against temp repos.
  Notes: the 2026-06-24 pilot surfaced real external-repo packaging/runtime bugs that existing in-repo tests did not catch.
- [ ] Add automated smoke tests for the built VS Code extension against disposable pilot workspaces.
  Status: Strong MVP improvement.
  Prerequisites: VSIX packaging hook, extension-host automation or documented manual harness, pilot fixture workspaces.
  Notes: this is the fastest way to keep CLI and VSIX behavior aligned once manual pilot coverage exists.
- [ ] Reduce VSIX size and file count with bundling and a tighter `.vscodeignore`.
  Status: Strong MVP improvement.
  Prerequisites: manual VSIX feedback, bundling approach selection, packaging verification after bundle output changes.
  Notes: current VSIX packaging succeeds, but `vsce` reports a large file count and recommends bundling for better extension performance and cleaner artifacts.
- [ ] Tighten runtime-budget enforcement and document realistic local-model latency expectations.
  Status: Strong MVP improvement.
  Prerequisites: inspect how `maxRuntimeMs` is enforced across multi-role runs, collect pilot timing data, decide whether to stop earlier or report soft overages more clearly.
  Notes: the first full local-only pilot run exceeded the nominal 60s runtime budget in practice.
  Current evidence:
  - The self-repo third-pilot rerun progressed through more roles after proposal-normalization fixes, then still blocked because runtime reached about 63s against the current 60s cap before tests could run.
- [ ] Improve coder patch quality for focused real-repo fixes so reviewer rejection is about real logic issues rather than malformed or low-fidelity rewrites.
  Status: MVP blocker.
  Prerequisites: tighter source-file grounding, diff-size control, file-content fidelity checks, real-repo regression fixtures from pilots.
  Notes: the blocker has shifted from assistant-control-path noise and file/operation mismatches toward patch quality itself.
- [ ] Make external-repo onboarding smoother for monorepos and local-only clones, especially when dependencies are not installed yet.
  Status: Strong MVP improvement.
  Prerequisites: better doctor guidance, bootstrap docs, maybe copy-safe or offline-friendly setup suggestions, interface hints in CLI/VSIX.
  Notes: the self-repo pilot showed that a plain clone was not immediately runnable for configured tests without dependency bootstrap.
- [ ] Cache repository summaries or other reusable repo-level context.
  Status: Future optimization, not required for MVP.
  Prerequisites: invalidation strategy, repo-fingerprint logic, summary quality checks.
  Notes: keep this behind real pilot evidence so we do not add stale-context bugs too early.
- [ ] Add disposable sandbox or temp-clone isolation for test and format commands.
  Status: Post-MVP security hardening unless pilot usage requires it sooner.
  Prerequisites: clone/worktree strategy, temp-state cleanup, command path remapping, Windows/macOS/Linux validation.
  Notes: consolidates the open Phase 13 and Seventh Milestone execution-isolation items.
- [ ] Add true branch isolation or temp-clone execution for assistant edits.
  Status: Post-MVP security hardening unless pilot usage requires it sooner.
  Prerequisites: worktree or temp-clone flow, patch/apply plumbing, approval UX updates.
  Notes: keep paired with the execution-isolation item above so the product has one coherent isolation model.
- [ ] Add signed packaging and release verification for CLI and VS Code artifacts.
  Status: Post-MVP distribution hardening.
  Prerequisites: signing identity choice, packaging pipeline changes, verification docs, release checklist.
  Notes: consolidates the open Phase 13, Phase 14, and Seventh Milestone artifact-signing items.
- [ ] Add dependency-vulnerability and lockfile-integrity checks to `doctor` or release validation.
  Status: Post-MVP operational hardening.
  Prerequisites: tool choice, offline/online behavior decision, false-positive policy.
  Notes: good candidate to pair with signed release verification.
- [ ] Add suspicious-file and prompt-injection heuristics for repository context selection.
  Status: Post-MVP security hardening.
  Prerequisites: heuristic design, quarantine UX, eval fixtures for malicious content.
  Notes: this is the next meaningful improvement after the current secret-path and binary/large-file controls.
- [ ] Add filesystem-permission checks for config, state, and crash-report directories on multi-user machines.
  Status: Future hardening.
  Prerequisites: cross-platform permission inspection, warning UX, docs.
  Notes: useful for broader adoption, but not needed for single-user MVP.
- [ ] Add exportable policy and audit attestations for hosted-routing acknowledgements and patch approvals.
  Status: Future enterprise-facing hardening.
  Prerequisites: attestation format, signing/integrity strategy, history export UX.
  Notes: not needed for the first MVP.
- [ ] Decide whether advanced budget overrides should be exposed in config.
  Status: Future product tuning, not required for MVP.
  Prerequisites: pilot feedback showing real need, schema design, doctor/docs updates.
  Notes: the current orchestration-owned defaults remain the right default until power-user demand is clearer.
- [ ] Decide whether dynamic role selection should be introduced.
  Status: Future optimization, not required for MVP.
  Prerequisites: enough real traces, role-level win/loss data, routing-quality evals.
  Notes: keep the fixed sequence until the current roles are clearly useful.
- [ ] Decide whether debt sync to GitHub Issues should be added.
  Status: Future integration, not required for MVP.
  Prerequisites: issue schema mapping, auth flow, duplicate sync strategy, user demand.
  Notes: preserve the current local-first debt flow as the baseline.
- [ ] Run a hosted or hybrid pilot using OpenAI after the local-only pass is stable.
  Status: Future validation phase, not required before local-only MVP.
  Prerequisites: close the highest-risk local-only MVP blockers first, decide which repos are safe for hosted routing, configure pricing limits and repository privacy, verify preflight secret scanning behavior.
  Notes: requested after the first local-only pilot pass.

## Definition Of Done For MVP

- [ ] Can run against at least three real TypeScript repositories.
- [ ] Can run against at least three real TypeScript repositories.
  Note: CLI-side evidence now covers `personal`, `mood-switcher`, and `dev-assistant`; keep this open until manual VSIX coverage is captured on the same trio.
- [x] Can complete small bug-fix tasks with human approval.
- [ ] Produces review findings that are sometimes genuinely useful.
- [ ] Can add or update tests for simple changes.
- [x] Runs configured tests and summarizes failures accurately.
- [x] Tracks technical debt without excessive noise.
- [x] Keeps all source local unless hosted mode is explicitly enabled.
- [x] Has clear logs for every agent decision and tool call.
- [x] Has basic evals that catch regressions.
- [x] Has baseline security controls for secrets, network use, provenance, and panic shutdown.
- [x] Warns before private repository code is routed to hosted providers.
- [x] Preserves tamper-evident local task history.
- [x] Has documentation good enough for another developer to install and try it.

## MVP Completion Plan

The fastest credible path to MVP and early daily usage is:

1. Close the remaining reviewer-quality work.
2. Close the remaining test-writer implementation work.
3. Run structured pilots on at least three real TypeScript repositories from both the CLI and VS Code extension.
4. Use the pilot results to tune context selection, narrow-test execution, and UX noise.
5. Only then decide whether post-MVP isolation/signing work must be pulled forward for your actual usage pattern.

Practical go/no-go recommendation:

- CLI: ready for supervised internal use now on small, low-risk tasks.
- VS Code extension: ready for supervised internal use now on small, low-risk tasks.
- Broad MVP sign-off: not yet, until the three open MVP checklist items are closed.

Latest closure status:

1. Close the remaining reviewer-quality work.
Status: materially improved, but keep open until the next manual VSIX pass and third TypeScript repo confirm the same quality outside the current seeded reruns.
2. Close the remaining test-writer implementation work.
Status: partially completed in code, but keep open until a real-repo end-to-end run safely authors or applies focused tests and gets through review/test execution.
3. Validate on three real TypeScript repositories.
Status: CLI evidence now covers `personal`, `mood-switcher`, and `dev-assistant`; manual VSIX validation on the same trio is the remaining closure step.

## Pilot Validation Program

Use this program to generate the next round of issues and decide whether Phase 15 is truly complete.

Reference:

- `docs/pilot-validation-2026-06-24.md`

Automatic validation to add or expand:

- [ ] Reviewer evals that require exact file-and-line citations.
- [ ] Test-writer evals that require authored tests to be applied and to pass.
- [ ] Real-repo regression fixtures derived from the first three pilot repositories.
- [ ] Context-selection evals that penalize irrelevant file stuffing and reward search-grounded context.
- [ ] Cost-and-runtime regression checks for common `run`, `review`, and `test` flows.
- [ ] Malicious-repo fixtures for prompt injection, hidden secrets, large files, and dangerous package scripts.
- [ ] CLI/VSIX golden-output tests for approval prompts, hosted-routing warnings, and failure summaries.
- [ ] Packaged CLI smoke tests that run from outside the monorepo root against temp-cloned repos.
- [ ] Runtime-budget regression checks that fail when local-only runs drift too far beyond configured limits.

Manual validation to run:

- [ ] End-to-end bug-fix task in three real TypeScript repositories from the CLI.
- [ ] End-to-end bug-fix task in the same repositories from the VS Code extension.
- [ ] Review-only flow where seeded defects should be caught and cited precisely.
- [ ] Test-authoring flow where the assistant must add focused tests without broad churn.
- [ ] Repo onboarding flow on different layouts: pnpm monorepo, npm single-package app, and mixed test frameworks.
- [ ] Hosted/hybrid confirmation flow in a private repository with intentionally placed secret-like files.
- [ ] Recovery flow after cancelled tasks, failed tests, and partially applied patches.
- [ ] Re-run the local-only pilot after coder patch-safety fixes and compare against `docs/pilot-validation-2026-06-24.md`.

Manual VSIX testing to do next:

- [ ] Follow [VSIX-TESTING.md](/Users/jasonp/repos/dev-assistant/VSIX-TESTING.md) for packaging, install/uninstall, disposable workspace creation, seeded regressions, and evidence capture.
- [ ] Use disposable clones of `personal` and `mood-switcher`, then use a disposable working-tree copy of this repo for the third TypeScript pilot workspace so local dependencies are already present.
- [ ] In `personal`, run Review Current Diff on the seeded `app/music/shared.tsx` regression and confirm the result includes a concrete file and line.
- [ ] In `mood-switcher`, run Review Current Diff on the seeded `src/extension.ts` regression and confirm the result includes a concrete file and line.
- [ ] In `dev-assistant`, run Review Current Diff on the seeded `packages/shared/src/model-routing.ts` regression and confirm the result includes a concrete file and line.
- [ ] In `personal` and `mood-switcher`, run one small coding task and confirm the patch preview no longer proposes edits under `.dev-assistant/`, `.git/`, or `dev-assistant.config.json` unless you explicitly asked for them.
- [ ] In `dev-assistant`, optionally run one small coding task and compare the extension behavior with the latest CLI pilot notes.
- [ ] In the same VSIX sessions, run Generate Tests For Current File and confirm the output now includes proposed test files and suggested test commands, not only prose recommendations.
- [ ] Confirm approval UI wording is clear for both file edits and shell commands, especially after a reviewer rejection or blocked run.
- [ ] Confirm the task timeline/history is readable during a full run and does not become too noisy.
- [ ] Confirm local-only privacy messaging stays clear and that no hosted-routing acknowledgement is shown unless you intentionally enable hosted routing.
- [ ] If the local model runtime throws `fetch failed` or similar transient errors, record the repo, command, timestamp, and any VS Code developer-console output so we can separate product issues from Ollama/runtime instability.

## TODO Part 2: Tentative Enhancements

These are useful next-step enhancements once MVP closure work is underway or complete.

- [ ] Add a compatibility matrix documenting known-good repo shapes, package managers, test frameworks, and operating systems.
- [ ] Add first-class onboarding presets for common repo types so `init` and `doctor` can suggest better defaults.
- [ ] Add richer task-history browsing and filtering in the VS Code extension.
- [ ] Add side-by-side run/review comparisons across local and hosted routing strategies.
- [ ] Add a “safe mode” preset that forces local-only, read-only, and no package scripts for especially sensitive repos.
- [ ] Add better summarization of why a command, edit, or hosted export was blocked.
- [ ] Add guided repair suggestions when `doctor` finds missing runtimes, misconfigured routes, or risky config.
- [ ] Add import/export for local debt, history summaries, and pilot reports.
- [ ] Add optional repository profiles so users can store different policies for different repos.
- [ ] Add a small sample repo pack specifically for manual onboarding and demo validation.

Ideas that should produce future TODO items or new phases after testing:

- [ ] Compare pilot results across multiple local models to decide whether the example default model should change.
- [ ] Track where users override or ignore reviewer advice; use that to create reviewer-quality phases.
- [ ] Track where test-writer output is rejected; use that to create test-authoring quality phases.
- [ ] Track which approval prompts confuse users; use that to create VS Code/CLI UX cleanup phases.
- [ ] Track which repo structures fail onboarding; use that to create compatibility and preset phases.
