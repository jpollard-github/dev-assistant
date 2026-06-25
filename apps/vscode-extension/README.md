# Dev Assistant VS Code Extension

VS Code packaging surface for the Dev Assistant sidebar, task timeline, review helpers, and approval flow.

Packaging:

```sh
corepack pnpm --filter ./apps/vscode-extension build
corepack pnpm --filter ./apps/vscode-extension package:vsix
```

Runtime setup and end-to-end workflow guidance live in the repository root:

- [`README.md`](../../README.md)
- [`docs/local-model-runtimes.md`](../../docs/local-model-runtimes.md)
- [`docs/example-workflows.md`](../../docs/example-workflows.md)
- [`VSIX-TESTING.md`](../../VSIX-TESTING.md)
