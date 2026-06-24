# Dev Assistant Threat Model

This document captures the current Phase 9 security posture for the local-first development assistant.

## Scope

- Primary runtime surfaces:
  - local repository read access
  - local shell/test execution
  - local and optional hosted model calls
  - local SQLite/task history and debt logs
- Primary trust boundary:
  - user intent and config are trusted
  - repository contents are treated as untrusted input

## Threats And Current Mitigations

### Prompt Injection In Repo Files

- Threat:
  - repository comments, tests, docs, or fixtures try to override system behavior or escalate tool usage
- Current mitigations:
  - prompts explicitly tell agents to treat repository content as untrusted
  - orchestration remains deterministic instead of open-ended agent-to-agent chat
  - approvals gate edits and risky shell commands
  - repo access stays bounded to configured MCP capabilities
- Remaining gaps:
  - no dedicated prompt-injection classifier yet
  - no automatic quarantine for suspicious files yet

### Malicious Package Scripts

- Threat:
  - test or format commands execute harmful shell operations through package-manager scripts
- Current mitigations:
  - shell commands must be allowlisted
  - network-capable commands are blocked unless security policy explicitly enables network access
  - panic mode can terminate registered subprocesses and halt new assistant actions
  - shell subprocesses run with a scrubbed environment instead of the full parent environment
- Remaining gaps:
  - commands still execute on the host OS
  - no disposable VM/container sandbox yet

### Secret Exfiltration

- Threat:
  - agents read `.env`, keys, credentials, or private key material and echo them to logs or hosted providers
- Current mitigations:
  - secret-like repo paths are blocked by default
  - logs redact common credential/token/private-key patterns
  - hosted and hybrid code-context routing require explicit opt-in
  - local-only mode remains the default
- Remaining gaps:
  - secret detection is heuristic, not full DLP
  - data already copied into non-secret files is not automatically classified

### Accidental Destructive Edits

- Threat:
  - generated patches modify the wrong files, touch git metadata, or make broad repo changes
- Current mitigations:
  - patch operations are validated against repo boundaries
  - `.git` metadata edits are blocked
  - budget limits cap changed files
  - default workflow is read-only until edit approval
  - generated code receives provenance comments where practical
- Remaining gaps:
  - no branch isolation or temporary workspace cloning yet
  - provenance comments are best-effort for commentable text/code files

### Runaway Token Or Compute Usage

- Threat:
  - loops, oversized prompts, or long-running subprocesses consume excessive local/hosted resources
- Current mitigations:
  - model-call, changed-file, shell-command, and runtime budgets exist
  - evals can catch regressions in task efficiency
  - panic mode can stop active subprocesses and block new runs
- Remaining gaps:
  - no preflight hosted-cost estimate yet
  - no per-task cost accounting or aggregate budget dashboard yet

## Design Notes

- The assistant is intentionally conservative:
  - local-first by default
  - explicit approvals
  - explicit opt-in for hosted code export
  - explicit network policy
- Security-sensitive follow-up work is tracked in later roadmap phases, especially Phase 10, Phase 11, and Phase 13.
