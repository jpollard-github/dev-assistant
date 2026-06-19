export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEvent {
  readonly level: LogLevel;
  readonly message: string;
  readonly context?: Record<string, unknown>;
  readonly timestamp: string;
}

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export function createLogger(namespace: string): Logger {
  const write = (level: LogLevel, message: string, context?: Record<string, unknown>) => {
    const event: LogEvent = {
      level,
      message,
      context: { namespace, ...context },
      timestamp: new Date().toISOString()
    };

    const serialized = JSON.stringify(event);
    if (level === "error") {
      console.error(serialized);
      return;
    }

    console.log(serialized);
  };

  return {
    debug: (message, context) => write("debug", message, context),
    info: (message, context) => write("info", message, context),
    warn: (message, context) => write("warn", message, context),
    error: (message, context) => write("error", message, context)
  };
}
