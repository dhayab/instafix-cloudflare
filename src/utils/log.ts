import type { Env } from '../env';

export type LogLevel = 'info' | 'warn' | 'error';

type Payload = Record<string, unknown>;

const LEVELS: Record<LogLevel, number> = { error: 0, warn: 1, info: 2 };

function resolveLevel(env: Env | undefined): number {
  const raw = env?.LOG_LEVEL?.toLowerCase();
  if (raw === 'error' || raw === 'warn' || raw === 'info') return LEVELS[raw];
  return LEVELS.info;
}

function emit(level: LogLevel, line: string): void {
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export function log(
  event: string,
  reqId: string,
  level: LogLevel,
  env: Env | undefined,
  payload?: Payload,
): void {
  if (LEVELS[level] > resolveLevel(env)) return;
  const line = JSON.stringify({
    event,
    level,
    reqId,
    ts: Date.now(),
    ...payload,
  });
  emit(level, line);
}

export function logError(
  event: string,
  reqId: string,
  env: Env | undefined,
  err: unknown,
  payload?: Payload,
): void {
  const reason = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  log(event, reqId, 'error', env, { ...payload, reason, stack });
}
