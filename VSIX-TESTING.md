# VSIX Testing Guide

This document is the single reference for manual VSIX validation of Dev Assistant.

Use it when validating the packaged VS Code extension against the current pilot repositories.

## Goal

Validate the VS Code extension manually against the same three strong TypeScript repositories now used for CLI pilot coverage:

- `personal`
- `mood-switcher`
- `dev-assistant`

Use disposable workspaces only. Do not test in the original repositories.

## Before You Start

Recommended prerequisites:

- Commit your current work in the original repositories to `main` before creating test workspaces.
- Make sure Ollama is running locally.
- Make sure the expected model is available:
  - `qwen2.5-coder:7b`

Useful checks:

```sh
ollama ps
ollama list
curl -sS http://127.0.0.1:11434/api/tags
```

## Build The VSIX

From the `dev-assistant` repo root:

```sh
corepack pnpm build
corepack pnpm package:vscode
```

Expected output artifact:

```sh
dist/dev-assistant.vsix
```

## Install The VSIX

Recommended UI path in VS Code:

1. Open VS Code.
2. Run `Extensions: Install from VSIX...`
3. Select `dist/dev-assistant.vsix`

Optional CLI path:

```sh
code --install-extension /Users/jasonp/repos/dev-assistant/dist/dev-assistant.vsix --force
```

## Uninstall The VSIX

Recommended UI path:

1. Open Extensions.
2. Find `Dev Assistant`.
3. Click `Uninstall`.

Optional CLI path:

```sh
code --list-extensions | rg dev-assistant
code --uninstall-extension <extension-id>
```

## Create Disposable Test Workspaces

Use `/private/tmp` so the originals stay clean.

```sh
mkdir -p /private/tmp/dev-assistant-vsix-pilots

git clone ~/repos/personal /private/tmp/dev-assistant-vsix-pilots/personal
git clone ~/repos/mood-switcher /private/tmp/dev-assistant-vsix-pilots/mood-switcher

rsync -a --exclude '.git' --exclude '.dev-assistant' ~/repos/dev-assistant/ /private/tmp/dev-assistant-vsix-pilots/dev-assistant-working-copy/
cd /private/tmp/dev-assistant-vsix-pilots/dev-assistant-working-copy
git init
git add .
git -c user.name='Pilot' -c user.email='pilot@example.com' commit -m 'baseline'
```

Why the self-repo uses a working-tree copy:

- a plain git clone of `dev-assistant` was not immediately ready for configured test execution without dependency bootstrap
- the working-tree copy preserves local dependencies and is a better manual VSIX target for this repo

## Add Dev Assistant Config Files

If the earlier temp configs still exist, you can reuse them:

```sh
cp /private/tmp/dev-assistant-pilots-rerun/personal/dev-assistant.config.json /private/tmp/dev-assistant-vsix-pilots/personal/
cp /private/tmp/dev-assistant-pilots-rerun/mood-switcher/dev-assistant.config.json /private/tmp/dev-assistant-vsix-pilots/mood-switcher/
cp /Users/jasonp/repos/dev-assistant/dev-assistant.config.json /private/tmp/dev-assistant-vsix-pilots/dev-assistant-working-copy/
```

If you need to recreate them manually, use these working baselines.

### `personal`

```json
{
  "repoPath": ".",
  "model": {
    "provider": "ollama",
    "name": "qwen2.5-coder:7b"
  },
  "allowedShellCommands": ["npm test", "npm run lint"],
  "formatCommands": [],
  "testCommands": ["npm test"],
  "approvalPolicy": "on-risky-action",
  "dataDir": ".dev-assistant",
  "mode": "local-only",
  "repositoryPrivacy": "private",
  "routing": {},
  "crashReporting": {
    "enabled": false,
    "directory": ".dev-assistant/crash-reports",
    "maxLocalReports": 20,
    "allowRemoteUpload": false
  },
  "security": {
    "allowNetwork": false,
    "allowSecretAccess": false,
    "allowHostedCodeContext": false,
    "allowDependencyInstalls": false,
    "allowPackageScripts": true,
    "blockBinaryFiles": true,
    "maxContextFileBytes": 262144,
    "allowedWritePaths": ["app", "tests", "docs"],
    "requiredGitBranch": "main",
    "redactLogs": true,
    "requireProvenanceComments": true,
    "panicFile": ".dev-assistant/panic.json",
    "processRegistryFile": ".dev-assistant/processes.json"
  }
}
```

### `mood-switcher`

```json
{
  "repoPath": ".",
  "model": {
    "provider": "ollama",
    "name": "qwen2.5-coder:7b"
  },
  "allowedShellCommands": ["npm run lint", "npm run build"],
  "formatCommands": [],
  "testCommands": ["npm run build"],
  "approvalPolicy": "on-risky-action",
  "dataDir": ".dev-assistant",
  "mode": "local-only",
  "repositoryPrivacy": "private",
  "routing": {},
  "crashReporting": {
    "enabled": false,
    "directory": ".dev-assistant/crash-reports",
    "maxLocalReports": 20,
    "allowRemoteUpload": false
  },
  "security": {
    "allowNetwork": false,
    "allowSecretAccess": false,
    "allowHostedCodeContext": false,
    "allowDependencyInstalls": false,
    "allowPackageScripts": true,
    "blockBinaryFiles": true,
    "maxContextFileBytes": 262144,
    "allowedWritePaths": ["src", "README.md"],
    "requiredGitBranch": "main",
    "redactLogs": true,
    "requireProvenanceComments": true,
    "panicFile": ".dev-assistant/panic.json",
    "processRegistryFile": ".dev-assistant/processes.json"
  }
}
```

### `dev-assistant`

```json
{
  "repoPath": ".",
  "model": {
    "provider": "ollama",
    "name": "qwen2.5-coder:7b"
  },
  "allowedShellCommands": [
    "corepack pnpm test"
  ],
  "testCommands": [
    "corepack pnpm test"
  ],
  "approvalPolicy": "never",
  "dataDir": ".dev-assistant",
  "mode": "local-only"
}
```

## Seed The Review Diffs

These commands create the same seeded regressions used in the pilot work.

### `personal`

```sh
perl -0pi -e 's/Math\.max\(\(value \/ max\) \* 100, 2\)/Math.min((value \/ max) * 100, 2)/g' /private/tmp/dev-assistant-vsix-pilots/personal/app/music/shared.tsx
```

Expected diff:

- `app/music/shared.tsx`
- `Math.max(...)` becomes `Math.min(...)`

### `mood-switcher`

```sh
perl -0pi -e 's/Date\.now\(\) >= session\.endsAt/Date.now() <= session.endsAt/g' /private/tmp/dev-assistant-vsix-pilots/mood-switcher/src/extension.ts
```

Expected diff:

- `src/extension.ts`
- `Date.now() >= session.endsAt` becomes `Date.now() <= session.endsAt`

### `dev-assistant`

```sh
perl -0pi -e 's/return config\.repositoryPrivacy === "public" \? "hosted" : "local";/return config.repositoryPrivacy === "public" ? "local" : "hosted";/g' /private/tmp/dev-assistant-vsix-pilots/dev-assistant-working-copy/packages/shared/src/model-routing.ts
```

Expected diff:

- `packages/shared/src/model-routing.ts`
- public reviewer routing is inverted

## Open The Workspaces In VS Code

Open these three folders, one at a time or in separate windows:

- `/private/tmp/dev-assistant-vsix-pilots/personal`
- `/private/tmp/dev-assistant-vsix-pilots/mood-switcher`
- `/private/tmp/dev-assistant-vsix-pilots/dev-assistant-working-copy`

## Manual VSIX Checklist

### Basic extension health

- Verify the sidebar loads.
- Verify the empty-state actions render vertically and remain readable in a narrow sidebar.
- Verify the `Quick Actions` section appears above active tasks once a task starts.
- Verify active task rows show concise status text and the event timeline reads cleanly without needing wide sidebar space.
- Verify workspace trust gating behaves correctly.
- Verify the extension activates without obvious startup errors.

### Review-only checks

- In `personal`, run `Review Current Diff` and confirm the finding includes:
  - `app/music/shared.tsx`
  - a concrete line reference
- In `mood-switcher`, run `Review Current Diff` and confirm the finding includes:
  - `src/extension.ts`
  - a concrete line reference
- In `dev-assistant`, run `Review Current Diff` and confirm the finding includes:
  - `packages/shared/src/model-routing.ts`
  - a concrete line reference

### Coding-task checks

- In `personal`, run one small coding task against the seeded regression.
- In `mood-switcher`, run one small coding task against the seeded regression.
- In `dev-assistant`, optionally run one small coding task against the seeded regression if you want to compare with the CLI pilot behavior.

While doing that, confirm:

- the task plan is understandable
- the patch preview is focused
- the reviewer findings are understandable
- cancellation works
- the final summary is useful

### Guardrail checks

- Confirm patch previews do not propose edits under:
  - `.dev-assistant/`
  - `.git/`
  - `dev-assistant.config.json`
  unless you explicitly asked for those files.
- Confirm local-only messaging is clear.
- Confirm no hosted-routing acknowledgement appears unless you intentionally enable hosted routing.
- Confirm approval UI wording is understandable for both file edits and shell commands.

### Test-writer checks

- Run `Generate Tests For Current File`.
- Confirm the output includes:
  - proposed test file paths
  - suggested test commands
  - not just prose recommendations

### Timeline/history checks

- Confirm the task timeline is readable.
- Confirm the event stream is not too noisy during a full run.
- Confirm blocked runs and reviewer rejections are easy to understand from the UI.

## What Output Is Useful To Capture

If anything fails, blocks, or looks suspicious, the most useful feedback is concrete evidence tied to a repo and step.

Capture as much of this as you can:

- repository name
- exact workspace path
- exact command or VS Code action you ran
- whether it was `Review Current Diff`, `Start Assistant Task`, `Generate Tests For Current File`, or another command
- timestamp
- screenshot of the visible UI state
- full task summary text
- reviewer finding text
- patch preview text or screenshot
- test-writer output text
- approval prompt wording
- blocked/error message verbatim

Especially useful raw data:

- VS Code `Output` panel logs if the extension writes anything there
- `Developer: Toggle Developer Tools` console errors
- `Help: Toggle Developer Tools` console/network errors if relevant
- any visible task id from the extension UI
- resulting `.dev-assistant/tasks.sqlite` state in the disposable workspace
- resulting `.dev-assistant/debt.md` entries if new debt was created

For model/runtime failures, record:

- whether Ollama was running
- output of `ollama ps`
- whether the failure said `fetch failed`, timeout, invalid JSON, or something else
- whether the same failure happened in one repo or all repos

## Optional CLI Cross-Checks

If a VSIX result looks strange, compare it with the CLI in the same disposable workspace.

Examples:

```sh
node /Users/jasonp/repos/dev-assistant/apps/cli/dist/index.js review --json
node /Users/jasonp/repos/dev-assistant/apps/cli/dist/index.js test --json
node /Users/jasonp/repos/dev-assistant/apps/cli/dist/index.js run "describe the task" --approve --json
node /Users/jasonp/repos/dev-assistant/apps/cli/dist/index.js history --json
```

## Cleanup

When you are done:

- uninstall the VSIX if you do not want it left installed
- remove the disposable workspaces under `/private/tmp/dev-assistant-vsix-pilots`

Example cleanup:

```sh
rm -rf /private/tmp/dev-assistant-vsix-pilots
```
