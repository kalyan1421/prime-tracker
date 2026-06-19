import { ConsoleLogger, LogLevel } from '@nestjs/common';

/**
 * Production logger that emits one JSON object per line to stdout, so CloudWatch
 * Logs Insights can query by field (level, context, message) instead of grepping
 * Nest's pretty-printed text. In development we keep the default ConsoleLogger
 * (human-readable colours), so this is only wired when NODE_ENV=production.
 *
 * Dependency-free (no pino) — the structured shape below is all CloudWatch needs.
 */
export class JsonLogger extends ConsoleLogger {
  private emit(level: LogLevel, message: unknown, context?: string, trace?: string) {
    const line = {
      level,
      time: new Date().toISOString(),
      context: context ?? this.context ?? undefined,
      message: typeof message === 'string' ? message : safeStringify(message),
      ...(trace ? { trace } : {}),
    };
    process.stdout.write(JSON.stringify(line) + '\n');
  }

  log(message: unknown, context?: string) {
    this.emit('log', message, context);
  }

  error(message: unknown, trace?: string, context?: string) {
    this.emit('error', message, context, trace);
  }

  warn(message: unknown, context?: string) {
    this.emit('warn', message, context);
  }

  debug(message: unknown, context?: string) {
    this.emit('debug', message, context);
  }

  verbose(message: unknown, context?: string) {
    this.emit('verbose', message, context);
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
