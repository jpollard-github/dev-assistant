import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { findSecretLikeMatches, isLikelyBinaryContent, isSensitivePath } from "./security.js";

export interface HostedExportSecretFinding {
  readonly path: string;
  readonly reason: string;
}

export function scanRepositoryForHostedSecrets(
  repoPath: string,
  options: {
    readonly maxFileBytes: number;
    readonly maxFindings?: number;
  }
): readonly HostedExportSecretFinding[] {
  const findings: HostedExportSecretFinding[] = [];
  const root = resolve(repoPath);
  const maxFindings = options.maxFindings ?? 10;

  walk(root, root, findings, {
    maxFileBytes: options.maxFileBytes,
    maxFindings
  });

  return findings;
}

function walk(
  root: string,
  current: string,
  findings: HostedExportSecretFinding[],
  options: {
    readonly maxFileBytes: number;
    readonly maxFindings: number;
  }
): void {
  if (findings.length >= options.maxFindings) {
    return;
  }

  for (const entry of readdirSync(current, { withFileTypes: true })) {
    if (findings.length >= options.maxFindings) {
      return;
    }

    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".next") {
      continue;
    }

    const fullPath = join(current, entry.name);
    const relativePath = relative(root, fullPath).replaceAll("\\", "/");

    if (entry.isDirectory()) {
      walk(root, fullPath, findings, options);
      continue;
    }

    if (isSensitivePath(relativePath)) {
      findings.push({
        path: relativePath,
        reason: "Sensitive-path pattern matched before hosted export."
      });
      continue;
    }

    let stats;
    try {
      stats = statSync(fullPath);
    } catch {
      continue;
    }

    if (stats.size > options.maxFileBytes) {
      continue;
    }

    let content: Buffer;
    try {
      content = readFileSync(fullPath);
    } catch {
      continue;
    }

    if (isLikelyBinaryContent(content)) {
      continue;
    }

    const matches = findSecretLikeMatches(content.toString("utf8"));
    if (matches.length > 0) {
      findings.push({
        path: relativePath,
        reason: "Secret-like content detected in a non-quarantined file."
      });
    }
  }
}
