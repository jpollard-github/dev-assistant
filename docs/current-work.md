# Current Work

## Active Work
- Phase 1 of the core orchestrator is now implemented in `packages/core` with:
- a task lifecycle state machine
- a typed event bus
- SQLite-backed task event persistence
- deterministic coordinator sequencing across coordinator, coder, reviewer, and test-runner roles
- budget enforcement and approval checkpoints
- The CLI now has a minimal `run` command that exercises the Phase 1 flow and writes task history to `.dev-assistant/phase-1.sqlite`.
- Validation completed successfully for `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm build`, and CLI smoke tests for both the base flow and the configured `testCommands` branch.

## Next Best Task
- Replace demo agent handlers with the real Phase 2 model adapter interface.
- Replace the default no-op patch applier and stub shell runner with real controlled services so smoke tests exercise actual execution paths.
- Make the CLI return a non-zero exit code when a task finishes in `blocked` status.
- Decide whether task budgets belong only at runtime or should also be added to the persisted user config schema.

## Risks Or Watchouts
- The current CLI `run` path uses demo agents, a no-op patch applier, and a stub shell runner. It validates orchestration and persistence, not real code editing or shell command execution.
- Approval checkpoints are enforced through an injected approval decider. The CLI currently blocks risky actions unless run with `--approve` or the config policy is `never`.
- The CLI currently prints a blocked task result without setting a failing process exit code, which could mislead automation until fixed.
