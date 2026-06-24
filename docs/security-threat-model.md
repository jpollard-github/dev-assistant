# Dev Assistant Threat Model

This document captures the current Phase 13 security posture for the local-first development assistant.

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
  - oversized and binary files are quarantined from normal context gathering
- Remaining gaps:
  - no dedicated prompt-injection classifier yet
  - no automatic quarantine for suspicious text files yet

### Malicious Package Scripts

- Threat:
  - test or format commands execute harmful shell operations through package-manager scripts
- Current mitigations:
  - shell commands must be allowlisted
  - network-capable commands are blocked unless security policy explicitly enables network access
  - dependency-install commands can be blocked entirely by policy
  - package-manager script execution can be blocked entirely by policy
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
  - private repositories require a per-run acknowledgement before hosted routing proceeds
  - hosted-routing preflight scans the repository for secret-like files/content before export
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
  - optional write-scope and required-branch controls can further constrain assistant edits
  - budget limits cap changed files
  - default workflow is read-only until edit approval
  - generated code receives provenance comments where practical
- Remaining gaps:
  - no true branch isolation or temporary workspace cloning yet
  - provenance comments are best-effort for commentable text/code files

### Runaway Token Or Compute Usage

- Threat:
  - loops, oversized prompts, or long-running subprocesses consume excessive local/hosted resources
- Current mitigations:
  - model-call, changed-file, shell-command, and runtime budgets exist
  - evals can catch regressions in task efficiency
  - panic mode can stop active subprocesses and block new runs
  - hosted tasks now show preflight cost estimates and report actual token usage when providers return it
- Remaining gaps:
  - no persisted per-task cost accounting dashboard yet
  - no aggregate budget dashboard yet

### Audit Trail Tampering

- Threat:
  - local task/event history is altered after the fact, weakening auditability
- Current mitigations:
  - task events include chained checksums to make tampering detectable
  - runtime diagnostics report whether the audit chain is intact
- Remaining gaps:
  - checksums are local integrity signals, not signed attestations
  - exported audit bundles and external verification do not exist yet

## Design Notes

- The assistant is intentionally conservative:
  - local-first by default
  - explicit approvals
  - explicit opt-in for hosted code export
  - explicit network policy
- Security-sensitive follow-up work is tracked in later roadmap phases, especially Phase 13 and the new Phase 14 supply-chain and operational hardening work.
- The main remaining hardening themes are disposable execution isolation, stronger release signing, and better suspicious-content detection before model exposure.
