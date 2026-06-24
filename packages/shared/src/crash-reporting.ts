import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { redactSecrets } from "./security.js";

export interface CrashReportingConfig {
  readonly enabled: boolean;
  readonly directory: string;
  readonly maxLocalReports: number;
  readonly allowRemoteUpload: boolean;
  readonly endpoint?: string | undefined;
}

export interface CrashReportPayload {
  readonly command: readonly string[];
  readonly cwd: string;
  readonly error: unknown;
  readonly extra?: Record<string, unknown>;
}

export interface CrashReportRecord {
  readonly id: string;
  readonly timestamp: string;
  readonly command: readonly string[];
  readonly cwd: string;
  readonly message: string;
  readonly stack?: string;
  readonly extra?: Record<string, unknown>;
}

export function resolveCrashReportDirectory(
  config: Pick<{ crashReporting: CrashReportingConfig }, "crashReporting">,
  cwd = process.cwd()
): string {
  return resolve(cwd, config.crashReporting.directory);
}

export function writeLocalCrashReport(
  config: Pick<{ crashReporting: CrashReportingConfig }, "crashReporting">,
  payload: CrashReportPayload
): string | null {
  if (!config.crashReporting.enabled) {
    return null;
  }

  const directory = resolveCrashReportDirectory(config, payload.cwd);
  mkdirSync(directory, { recursive: true });

  const error = normalizeCrashError(payload.error);
  const record: CrashReportRecord = redactSecrets(
    withOptionalProperties(
      {
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        command: [...payload.command],
        cwd: payload.cwd,
        message: error.message
      },
      {
        stack: error.stack,
        extra: payload.extra
      }
    )
  );
  const filename = resolve(directory, `${record.timestamp.replaceAll(":", "-")}-${record.id}.json`);
  writeFileSync(filename, JSON.stringify(record, null, 2).concat("\n"), "utf8");
  pruneCrashReports(directory, config.crashReporting.maxLocalReports);
  return filename;
}

export function listCrashReports(
  config: Pick<{ crashReporting: CrashReportingConfig }, "crashReporting">,
  cwd = process.cwd()
): readonly string[] {
  const directory = resolveCrashReportDirectory(config, cwd);
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory)
    .filter((entry) => entry.endsWith(".json"))
    .sort()
    .map((entry) => resolve(directory, entry));
}

function normalizeCrashError(error: unknown): { readonly message: string; readonly stack?: string } {
  if (error instanceof Error) {
    return withOptionalProperties(
      {
        message: error.message
      },
      {
        stack: error.stack
      }
    );
  }

  return {
    message: String(error)
  };
}

function withOptionalProperties<TBase extends object, TOptional extends Record<string, unknown>>(
  base: TBase,
  optional: TOptional
): TBase & Partial<TOptional> {
  return Object.fromEntries(
    [...Object.entries(base), ...Object.entries(optional).filter(([, value]) => value !== undefined)]
  ) as TBase & Partial<TOptional>;
}

function pruneCrashReports(directory: string, maxLocalReports: number): void {
  const reports = readdirSync(directory)
    .filter((entry) => entry.endsWith(".json"))
    .sort();

  const overflow = reports.length - maxLocalReports;
  if (overflow <= 0) {
    return;
  }

  for (const entry of reports.slice(0, overflow)) {
    try {
      rmSync(resolve(directory, entry), { force: true });
    } catch {}
  }
}
