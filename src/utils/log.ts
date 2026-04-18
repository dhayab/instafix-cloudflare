import type { Env } from '../env';

export type LogLevel = 'info' | 'warn' | 'error';

type Payload = Record<string, unknown>;

const LEVELS: Record<LogLevel, number> = { error: 0, warn: 1, info: 2 };

// Depth 0 is the outermost request boundary; everything else sits one level
// in. Kept intentionally shallow (2 levels) — more nesting is more rules to
// remember for little extra signal in CF's observability message column.
const EVENT_DEPTH: Record<string, number> = {
  'request.start': 0,
  'request.done': 0,
};

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

function s(v: unknown): string {
  return v === undefined || v === null ? '' : String(v);
}

function ms(v: unknown): string {
  return typeof v === 'number' ? `${v}ms` : '';
}

function detail(event: string, p: Payload): string {
  const parts = (xs: Array<string>) => xs.filter(Boolean).join(' ');
  switch (event) {
    case 'request.start':
      return parts([s(p.method), s(p.path)]);
    case 'request.done':
      return parts([s(p.handler), s(p.outcome), s(p.status), ms(p.durationMs)]);
    case 'scraper.done':
      return parts([
        s(p.source),
        s(p.mediaCount),
        p.source === 'cache' ? '' : ms(p.durationMs),
      ]);
    case 'scraper.oembed':
      return p.outcome === 'ok'
        ? parts(['ok', ms(p.durationMs)])
        : parts(['failed', s(p.type), s(p.status), ms(p.durationMs)]);
    case 'scraper.br':
      if (p.outcome === 'ok') {
        return parts(['ok', s(p.shape), s(p.mediaCount), ms(p.durationMs)]);
      }
      if (p.outcome === 'disabled') return 'disabled';
      if (p.outcome === 'skipped_over_cap') {
        return `skipped_over_cap ${s(p.capCount)}/${s(p.cap)}`;
      }
      return parts(['failed', s(p.type), s(p.status), ms(p.durationMs)]);
    case 'br.cap.over':
      return `${s(p.count)}/${s(p.cap)}`;
    case 'br.cap.counter_failed':
    case 'compose.failed':
      return `${s(p.type)}: ${s(p.reason)}`;
    default:
      return '';
  }
}

function buildMessage(event: string, payload: Payload): string {
  const depth = EVENT_DEPTH[event] ?? 1;
  const indent = '  '.repeat(depth);
  const body = detail(event, payload);
  return body ? `${indent}[${event}] ${body}` : `${indent}[${event}]`;
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
    message: buildMessage(event, payload ?? {}),
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
