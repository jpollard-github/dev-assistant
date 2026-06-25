import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const extensionRoot = resolve(import.meta.dirname, "..");
const distRoot = join(extensionRoot, "dist");
const vendorRoot = join(distRoot, "vendor");

const packageEntryMap = {
  "@dev-assistant/agents": join(distRoot, "packages/agents/src/index.js"),
  "@dev-assistant/core": join(distRoot, "packages/core/src/index.js"),
  "@dev-assistant/llm": join(distRoot, "packages/llm/src/index.js"),
  "@dev-assistant/mcp-servers": join(distRoot, "packages/mcp-servers/src/index.js"),
  "@dev-assistant/shared": join(distRoot, "packages/shared/src/index.js"),
  zod: join(vendorRoot, "zod/index.js")
};

ensureVendoredDependency("zod");

for (const filePath of walkJavaScriptFiles(distRoot)) {
  const source = readFileSync(filePath, "utf8");
  const rewritten = rewritePackageImports(filePath, source);

  if (rewritten !== source) {
    writeFileSync(filePath, rewritten, "utf8");
  }
}

function* walkJavaScriptFiles(root) {
  for (const entry of readdirSync(root)) {
    const fullPath = join(root, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      yield* walkJavaScriptFiles(fullPath);
      continue;
    }

    if (extname(fullPath) === ".js") {
      yield fullPath;
    }
  }
}

function rewritePackageImports(fromFilePath, source) {
  let result = source;

  for (const [specifier, targetPath] of Object.entries(packageEntryMap)) {
    const relativePath = toImportPath(relative(fromFilePathDirectory(fromFilePath), targetPath));
    result = result.replaceAll(`"${specifier}"`, `"${relativePath}"`);
  }

  return result;
}

function fromFilePathDirectory(filePath) {
  return resolve(filePath, "..");
}

function toImportPath(value) {
  const normalized = value.replace(/\\/g, "/");
  return normalized.startsWith(".") ? normalized : `./${normalized}`;
}

function ensureVendoredDependency(packageName) {
  const targetDir = join(vendorRoot, packageName);
  const sourceDir = findRuntimeDependencySource(packageName);

  mkdirSync(vendorRoot, { recursive: true });
  rmSync(targetDir, { force: true, recursive: true });
  cpSync(sourceDir, targetDir, { recursive: true, dereference: true });
}

function findRuntimeDependencySource(packageName) {
  const candidates = [
    join(extensionRoot, "../../node_modules", packageName),
    join(extensionRoot, "../../node_modules/.pnpm/node_modules", packageName)
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Could not locate runtime dependency "${packageName}" for VSIX packaging.`);
}
