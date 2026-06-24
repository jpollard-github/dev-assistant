# Pilot Validation Report: 2026-06-24

This document records a first local-only pilot validation pass for Dev Assistant against three local repositories using disposable git clones under `/private/tmp/dev-assistant-pilots-git`.

Original repositories were left untouched. All assistant configs, diffs, generated state, and command outputs for the pilot lived only in the temporary clones.

## Pilot Repositories

- `/Users/jasonp/repos/personal`
  Type: Next.js 16 + React 19 + TypeScript application
- `/Users/jasonp/repos/mood-switcher`
  Type: VS Code extension in TypeScript
- `/Users/jasonp/spotify-export`
  Type: local Node/music-data tooling repo with limited TypeScript usage
- `/Users/jasonp/repos/dev-assistant`
  Type: TypeScript pnpm monorepo with CLI and VS Code extension packages

## Important Scope Note

This pilot does **not** fully satisfy the Phase 15 item "Validate the assistant on at least three real TypeScript repositories."

Reason:

- `personal` is a strong TypeScript/Next.js representative.
- `mood-switcher` is a strong TypeScript/VS Code extension representative.
- `spotify-export` is useful as a real local repo and API/data-script edge case, but it is not a strong TypeScript repository because it only contains minimal TypeScript.

Result:

- The product now has evidence across four real repositories.
- The stronger TypeScript trio for MVP-style compatibility coverage is now `personal`, `mood-switcher`, and `dev-assistant`.
- `spotify-export` remains useful edge-case coverage for local-data/script repos.

## What Was Tested

Baseline local-only setup and command checks:

- `doctor`
- `test`
- repo-specific shell/test command validation

Reviewer validation:

- one seeded regression per repo
- `review --json` using the local Ollama path

End-to-end coding validation:

- one seeded regression in `personal`
- one full `run --approve --json` local-only task
- one seeded regression in a disposable working-copy of `dev-assistant`
- one full `run --approve --json` local-only task in that disposable working-copy

## Baseline Results

### personal

- Baseline direct repo tests passed.
- `dev-assistant doctor --json` passed.
- `dev-assistant test --json` passed.

### mood-switcher

- Baseline direct repo lint/build passed.
- `dev-assistant doctor --json` passed.
- `dev-assistant test --json` passed using `npm run build`.

### spotify-export

- Initial cloned-repo script execution failed because ignored input data under `raw/` was not present in the git clone.
- After copying `raw/` into the temp clone only, `npm run spotify:analyze` succeeded.
- `dev-assistant doctor --json` passed with a warning for missing recognized package-manager lockfile.
- `dev-assistant test --json` passed using `npm run spotify:analyze`.

### dev-assistant

- A plain git clone was not immediately runnable for configured tests because workspace dependency bootstrap was missing, which is expected for a clone but still important onboarding evidence.
- An offline install attempt was blocked by local dependency-state issues, so the pilot switched to a disposable working-tree copy with dependencies included.
- In that disposable working-tree copy, `dev-assistant doctor --json` passed with the usual local Ollama warning in sandboxed mode.
- In that disposable working-tree copy, `dev-assistant test --json` passed.

## Reviewer Results

The reviewer caught the seeded regression in all three repos.

### personal

- Caught the `Math.max` -> `Math.min` regression in `app/music/shared.tsx`.
- Weakness: finding did not include file/line metadata in this run.

### mood-switcher

- Caught the session timer comparison regression in `src/extension.ts`.
- Strength: included file and line reference.

### spotify-export

- Caught the reversed `ratio(part, total)` logic in `scripts/spotify-analyze.mjs`.
- Strength: included file and line reference.

## Second-Pass Reviewer Rerun

After the first pilot, reviewer-quality follow-up work was implemented and the same seeded regressions were rerun on fresh disposable clones.

Result:

- `personal`: reviewer caught the regression and returned `app/music/shared.tsx` with a concrete line reference.
- `mood-switcher`: reviewer caught the regression and returned `src/extension.ts` with a concrete line reference.
- `spotify-export`: reviewer caught the regression and returned `scripts/spotify-analyze.mjs` with a concrete line reference.
- `dev-assistant`: reviewer caught the seeded `packages/shared/src/model-routing.ts` routing regression and returned a concrete file and line reference.

What changed in the product:

- CLI and VSIX review flows now enrich missing `filePath` and `line` metadata from final diff context.
- This materially improves reviewer actionability for seeded review tasks, though broader real-world tuning is still open.

## End-To-End Run Result

Repo:

- `personal`

Prompt:

- `Fix the regression in app/music/shared.tsx where percentages are capped incorrectly and run the configured tests.`

Outcome:

- task ended `blocked`
- reviewer rejected the produced patch
- configured tests did not run

What happened:

- the coder produced a bad patch that effectively replaced `app/music/shared.tsx` with incorrect content
- the reviewer correctly rejected the patch
- the coordinator surfaced the run as blocked instead of silently applying a bad fix

Why this matters:

- this is a meaningful positive safety signal for review gating
- this is also a meaningful negative MVP signal for coder reliability on real repos

## Test-Writer Follow-Up Status

Follow-up implementation after the first pilot improved the test-writer path:

- the advisory test-writer can now return concrete `files`, `operations`, and `commands`
- CLI and VSIX runs can merge focused test-file edits into coder proposals
- coder proposals are now sanitized to remove assistant-control paths like `.dev-assistant/`, `.git/`, and `dev-assistant.config.json` when the user did not ask for them

However, the end-to-end real-repo proof is still open:

- a fresh rerun on `personal` intended to validate the improved path was interrupted by a local Ollama/runtime `fetch failed` error before the full workflow completed
- this should be treated as an environment/runtime blocker, not proof that the product flow is complete

## Third TypeScript Repo Follow-Up

The third TypeScript-heavy pilot repo is now `dev-assistant` itself, validated via a disposable working-tree copy under `/private/tmp`.

Seeded regression:

- inverted public reviewer routing in `packages/shared/src/model-routing.ts`

Reviewer result:

- review-only mode caught the regression with `filePath: packages/shared/src/model-routing.ts` and a concrete line reference

Full run result:

- the first self-repo full run exposed a malformed proposal handoff where declared `files` and concrete `operations` disagreed
- follow-up product work fixed proposal reconciliation and path normalization for CLI/VSIX coder outputs
- a later rerun progressed much further through coordinator, coder, reviewer, architecture-review, technical-debt, and test-writer work
- that rerun still ended `blocked`, but for higher-signal reasons:
  - runtime budget exceeded the current 60s cap
  - coder patch quality remained poor enough for reviewer rejection

Why this matters:

- the third TypeScript-heavy repository requirement now has real CLI pilot evidence
- reviewer quality looks meaningfully better than before
- the remaining blocker has shifted from malformed patch metadata toward actual patch quality and runtime-budget tuning

## Product Findings From This Pilot

### Confirmed Strengths

- Local-only repo validation works well for baseline shell/test flows.
- Security-oriented config defaults were practical in real repos.
- Review-only mode produced useful findings on seeded regressions.
- Temporary clone workflow is a safe way to validate real repos without touching originals.

### Confirmed Weaknesses

- The CLI had two real packaging/runtime issues when invoked against external repos:
  - missing `@dev-assistant/shared` dependency in `@dev-assistant/mcp-servers`
  - runtime import of `../../shared/src/debt.js` instead of package-safe shared exports
- Reviewer output still has inconsistent file/line citation quality.
- Coder reliability is not yet good enough for MVP sign-off on small real-repo fixes.
- The full local-only `run` flow was slow enough that practical daily use still needs tuning.
- One repo type with ignored local inputs (`spotify-export`) needed manual data copying into the temp clone, which suggests onboarding/readiness checks could be better.
- A plain clone of this repo was not enough for end-to-end testing because workspace dependency bootstrap was missing; a disposable working-tree copy worked better for validation.
- Full self-repo runs show the runtime budget is still too tight for the current multi-advisory local-only flow.

## Manual VSIX Testing Still Needed

These items could not be validated automatically in this terminal-only session and should be run manually against the same repos.

### Setup

1. Package the extension or launch the Extension Development Host from this repo.
2. Open each pilot clone, not the original repo:
   - `/private/tmp/dev-assistant-pilots-git/personal`
   - `/private/tmp/dev-assistant-pilots-git/mood-switcher`
   - `/private/tmp/dev-assistant-pilots-git/spotify-export`
   - for the self-repo pilot, prefer a disposable working-tree copy rather than a plain clone if you want configured tests to run without extra bootstrap
3. Confirm each clone still has its `dev-assistant.config.json`.

### VSIX Manual Checklist

- Verify the sidebar loads and workspace trust gating behaves correctly.
- Start a review task on the seeded diff in each repo and confirm the finding quality.
- Start a small coding task in `personal` and `mood-switcher` and compare:
  - plan quality
  - patch preview quality
  - reviewer findings
  - cancellation behavior
  - final summary usefulness
- Confirm patch previews do not include `.dev-assistant/`, `.git/`, or `dev-assistant.config.json` unless that was explicitly requested.
- Run `Generate Tests For Current File` and confirm the output includes proposed test files and suggested commands, not only prose coverage ideas.
- Confirm approval UI for edits and shell commands is understandable.
- Confirm history/timeline events are not too noisy during a full run.
- Confirm private/local-only messaging is clear and that no hosted-routing prompts appear in local-only mode.
- In `spotify-export`, verify whether the extension gives enough signal when a repo depends on ignored local input folders like `raw/`.

## Recommended Follow-Up

- Treat the CLI-side three-TypeScript-repo validation goal as covered by `personal`, `mood-switcher`, and `dev-assistant`, while keeping manual VSIX validation open.
- Re-run the same pilot after coder safety/reliability improvements.
- Run a second-pass pilot in hybrid/hosted mode after the local-only MVP blockers are addressed.
