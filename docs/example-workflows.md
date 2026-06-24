# Example Workflows

## 1. First-Time Repository Setup

```sh
corepack pnpm build
dev-assistant init
dev-assistant doctor
dev-assistant config
```

Then edit `dev-assistant.config.json` to allow only the test and format commands you trust.

## 2. Small Bug Fix

```sh
dev-assistant run "Fix the failing edge case in src/parser.ts and run the relevant tests"
```

What you get:

- a coordinator plan
- a focused coder proposal
- reviewer feedback on the final diff
- test-runner output for configured commands
- optional advisory outputs for tests, architecture, and technical debt

## 3. Review-Only Pass

```sh
dev-assistant review
```

Use this when you already have a working-tree diff and want a correctness/regression pass without asking the assistant to edit files.

## 4. Hybrid Coding With Local Review

Example routing:

```json
{
  "mode": "hybrid",
  "repositoryPrivacy": "internal",
  "routing": {
    "coder": "hosted",
    "reviewer": "local",
    "technical-debt": "local"
  }
}
```

This keeps planning, debt tracking, and review local while letting the coding role use a stronger hosted model.

## 5. Debt Triage Loop

```sh
dev-assistant debt list
dev-assistant debt export --format markdown
dev-assistant debt resolve <id> --note "Fixed in refactor"
dev-assistant debt defer <id> --note "Wait for API migration"
```

## 6. Incident-Oriented Safety Flow

```sh
dev-assistant panic
dev-assistant panic --clear
dev-assistant doctor
```

Use panic mode to stop registered subprocesses and block new assistant actions until you clear it.
