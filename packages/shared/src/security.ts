import { resolve } from "node:path";

import { z } from "zod";

export const securityConfigSchema = z
  .object({
    allowNetwork: z.boolean().default(false),
    allowSecretAccess: z.boolean().default(false),
    allowHostedCodeContext: z.boolean().default(false),
    allowDependencyInstalls: z.boolean().default(false),
    allowPackageScripts: z.boolean().default(true),
    blockBinaryFiles: z.boolean().default(true),
    maxContextFileBytes: z.number().int().positive().default(262_144),
    allowedWritePaths: z.array(z.string().min(1)).default([]),
    requiredGitBranch: z.string().min(1).optional(),
    redactLogs: z.boolean().default(true),
    requireProvenanceComments: z.boolean().default(true),
    panicFile: z.string().min(1).default(".dev-assistant/panic.json"),
    processRegistryFile: z.string().min(1).default(".dev-assistant/processes.json")
  })
  .default({
    allowNetwork: false,
    allowSecretAccess: false,
    allowHostedCodeContext: false,
    allowDependencyInstalls: false,
    allowPackageScripts: true,
    blockBinaryFiles: true,
    maxContextFileBytes: 262_144,
    allowedWritePaths: [],
    redactLogs: true,
    requireProvenanceComments: true,
    panicFile: ".dev-assistant/panic.json",
    processRegistryFile: ".dev-assistant/processes.json"
  });

export type SecurityConfig = z.infer<typeof securityConfigSchema>;

const SECRET_PATH_PATTERNS = [
  /^\.env($|\.)/i,
  /^\.npmrc$/i,
  /^\.yarnrc(\.yml)?$/i,
  /^\.pnpmrc$/i,
  /^\.pypirc$/i,
  /^\.netrc$/i,
  /^\.terraform\//i,
  /^\.aws\//i,
  /^\.ssh\//i,
  /^\.gnupg\//i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /\.(pem|key|p12|pfx|crt|cer|der|jks)$/i,
  /(^|\/)(secrets?|credentials?)($|\/)/i
] as const;

const SECRET_VALUE_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AIza[0-9A-Za-z\-_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g,
  /\b(AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\b(OPENAI_API_KEY|ANTHROPIC_API_KEY|GITHUB_TOKEN|AWS_SECRET_ACCESS_KEY|DATABASE_URL|SESSION_SECRET|JWT_SECRET)\s*[:=]\s*["']?[^"'\s]+["']?/gi,
  /\bBearer\s+[A-Za-z0-9._\-]+\b/gi
] as const;

const NETWORK_COMMAND_PATTERNS = [
  /(^|\s)(curl|wget|lynx|httpie|http)\b/i,
  /(^|\s)(ssh|scp|sftp|rsync)\b/i,
  /(^|\s)(nc|netcat|telnet|ftp)\b/i,
  /(^|\s)(npm|pnpm|yarn|bun)\s+(install|add|dlx|create)\b/i,
  /(^|\s)(pip|pip3|poetry)\s+(install|add)\b/i,
  /(^|\s)(brew|apt|apt-get|yum|dnf|pacman)\s+(install|update|upgrade)\b/i,
  /(^|\s)(git)\s+(fetch|pull|push|clone)\b/i,
  /https?:\/\//i
] as const;

const DEPENDENCY_INSTALL_COMMAND_PATTERNS = [
  /(^|\s)(npm|pnpm|yarn|bun)\s+(install|add|dlx|create)\b/i,
  /(^|\s)(pip|pip3|poetry)\s+(install|add)\b/i,
  /(^|\s)(brew|apt|apt-get|yum|dnf|pacman)\s+(install|update|upgrade)\b/i
] as const;

const PACKAGE_SCRIPT_COMMAND_PATTERNS = [
  /(^|\s)(npm)\s+run\b/i,
  /(^|\s)(pnpm|yarn|bun)\s+(run\s+)?[A-Za-z0-9:_-]+\b/i
] as const;

export function isSensitivePath(path: string): boolean {
  return SECRET_PATH_PATTERNS.some((pattern) => pattern.test(path));
}

export function redactSecrets<T>(value: T): T {
  if (typeof value === "string") {
    return redactString(value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactSecrets(entry)) as T;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => [
      key,
      redactSecrets(entryValue)
    ]);
    return Object.fromEntries(entries) as T;
  }

  return value;
}

export function redactString(value: string): string {
  let next = value;

  for (const pattern of SECRET_VALUE_PATTERNS) {
    next = next.replace(pattern, "[REDACTED]");
  }

  return next;
}

export function containsLikelyNetworkCommand(command: string): boolean {
  return NETWORK_COMMAND_PATTERNS.some((pattern) => pattern.test(command));
}

export function containsLikelyDependencyInstallCommand(command: string): boolean {
  return DEPENDENCY_INSTALL_COMMAND_PATTERNS.some((pattern) => pattern.test(command));
}

export function containsLikelyPackageScriptCommand(command: string): boolean {
  return PACKAGE_SCRIPT_COMMAND_PATTERNS.some((pattern) => pattern.test(command));
}

export function findSecretLikeMatches(value: string): readonly string[] {
  const matches = new Set<string>();

  for (const pattern of SECRET_VALUE_PATTERNS) {
    const globalPattern = new RegExp(pattern.source, pattern.flags);
    for (const match of value.matchAll(globalPattern)) {
      if (match[0]) {
        matches.add(match[0].slice(0, 120));
      }
    }
  }

  return [...matches];
}

export function isLikelyBinaryContent(content: Uint8Array): boolean {
  const sample = content.subarray(0, Math.min(content.length, 4_096));
  for (const byte of sample) {
    if (byte === 0) {
      return true;
    }
  }

  return false;
}

export function resolvePanicFilePath(
  config: Pick<{ security: SecurityConfig }, "security">,
  cwd = process.cwd()
): string {
  return resolve(cwd, config.security.panicFile);
}

export function resolveProcessRegistryPath(
  config: Pick<{ security: SecurityConfig }, "security">,
  cwd = process.cwd()
): string {
  return resolve(cwd, config.security.processRegistryFile);
}
