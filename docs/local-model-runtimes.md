# Local Model Runtime Setup

This project defaults to `mode: "local-only"` and expects a local model runtime unless you explicitly enable hosted routing.

## Ollama

Recommended starter path:

```sh
ollama pull qwen2.5-coder:7b
ollama pull qwen2.5:3b
ollama serve
dev-assistant doctor
```

Suggested roles:

- `qwen2.5-coder:7b` for coding and review.
- `qwen2.5:3b` or another cheaper local model for planning and summaries when you later customize routing.

## Hosted Hybrid Setup

Only enable this when you are comfortable sending repository context off-machine:

1. Set `security.allowNetwork` to `true`.
2. Set `security.allowHostedCodeContext` to `true`.
3. Configure the `hosted` block with `baseUrl`, `apiKeyEnvVar`, and pricing.
4. Set `repositoryPrivacy` and `routing` intentionally.
5. Run `dev-assistant doctor` and confirm hosted/privacy warnings are acceptable.

## First-Run Checklist

Run these before your first real task:

```sh
corepack pnpm build
dev-assistant doctor
dev-assistant init
dev-assistant config doctor
dev-assistant test
```

## Runtime Notes

- `dev-assistant doctor` now creates or migrates the local SQLite task store and reports its schema version.
- Crash reporting is disabled by default. If you opt in, local crash JSON files are written under `.dev-assistant/crash-reports/`.
- Hosted cost estimates remain `0` until you fill in `hosted.pricing`.
