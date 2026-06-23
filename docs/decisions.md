# Decisions

## Decision Log
- Phase 1 uses injected agent handlers rather than calling a real model backend directly.
Context: Phase 2 owns the provider interface and local model integration.
Consequences: The coordinator can validate schemas, persist events, enforce budgets, and exercise lifecycle logic now without coupling orchestration to a specific LLM backend.

- Phase 1 task history is stored in SQLite using Node's built-in `node:sqlite` module.
Context: The repo runs on Node 24 and Phase 1 only needs local durable event storage.
Consequences: We avoid an extra database dependency while still getting durable task and event persistence in `.dev-assistant/phase-1.sqlite`.

- Agent outputs are defined with both runtime validation schemas and exported JSON schema objects in `packages/agents`.
Context: The TODO requires JSON schemas for all agent outputs plus retry behavior for invalid outputs.
Consequences: Core orchestration can validate agent responses consistently and record schema failures as auditable events.

- Phase 1 exposes a minimal `dev-assistant run` flow before real tool execution is wired in.
Context: We wanted an end-to-end orchestration path and smoke-testable CLI before Phase 2 model integration and Phase 3 tool services.
Consequences: The current CLI is useful for validating lifecycle, budgets, approvals, and persistence, but future work must preserve that flow while swapping the stub patch/shell services for real implementations.

## Candidate Decisions To Confirm
- Should task budget defaults live only in orchestration code, or also become part of the user config file?
- Should Phase 2 keep the current four-role deterministic sequence, or should role selection become data-driven once real agents are available?
