import { ConsoleLogger, LogLevel } from '@nestjs/common';

/**
 * LOG_LEVEL → the Nest levels that are switched on. Each name enables itself and every
 * level more severe than it. `info` is accepted as the conventional name for Nest's `log`.
 */
const LEVELS_BY_NAME: Record<string, LogLevel[]> = {
  fatal: ['fatal'],
  error: ['fatal', 'error'],
  warn: ['fatal', 'error', 'warn'],
  info: ['fatal', 'error', 'warn', 'log'],
  log: ['fatal', 'error', 'warn', 'log'],
  debug: ['fatal', 'error', 'warn', 'log', 'debug'],
  verbose: ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'],
};

/**
 * Which levels to emit. Production defaults to `info`: debug and verbose lines are for a
 * developer's terminal, and in production they have carried whole domain events (buyer
 * names, tenants, amounts) into CloudWatch. Development keeps debug on, as before.
 *
 * An unrecognised value falls back to the default rather than failing the boot — a typo
 * in LOG_LEVEL should cost verbosity, not availability.
 */
export function resolveLogLevels(raw: string | undefined | null, isProd: boolean): LogLevel[] {
  const name = String(raw ?? '').trim().toLowerCase();
  return LEVELS_BY_NAME[name] ?? LEVELS_BY_NAME[isProd ? 'info' : 'debug'];
}

/**
 * Production logger that emits one JSON object per line to stdout, so CloudWatch
 * Logs Insights can query by field (level, context, message) instead of grepping
 * Nest's pretty-printed text. In development we keep the default ConsoleLogger
 * (human-readable colours), so this is only wired when NODE_ENV=production.
 *
 * Dependency-free (no pino) — the structured shape below is all CloudWatch needs.
 *
 * Every method checks `isLevelEnabled` first. ConsoleLogger does that inside its own
 * methods, and overriding them without it is what made this logger print debug lines in
 * production regardless of configuration. Construct it as
 * `new JsonLogger('', { logLevels: resolveLogLevels(...) })`.
 */
export class JsonLogger extends ConsoleLogger {
  private emit(level: LogLevel, message: unknown, context?: string, trace?: string) {
    if (!this.isLevelEnabled(level)) return;
    const line = {
      level,
      time: new Date().toISOString(),
      context: context || this.context || undefined,
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

  fatal(message: unknown, context?: string) {
    this.emit('fatal', message, context);
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
