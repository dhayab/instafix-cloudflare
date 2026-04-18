import type { Env } from '../env';
import { log } from '../utils/log';

const DEFAULT_CAP = 300;
const COUNTER_TTL_SECONDS = 48 * 60 * 60;

function dayKey(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `br:usage:${y}-${m}-${d}`;
}

function getCap(env: Env): number {
  const raw = env.BR_DAILY_CAP;
  if (!raw) return DEFAULT_CAP;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CAP;
}

export interface BRCapState {
  over: boolean;
  count: number;
  cap: number;
}

/**
 * Fail-open: if the KV read errors, allow the BR call. This is a cost
 * safety net, not a hard gate — Cloudflare billing alerts catch the real
 * runaway. Returning `over: true` here would degrade the user experience
 * for transient KV flakiness.
 */
export async function getBRCapState(
  env: Env,
  reqId: string,
): Promise<BRCapState> {
  const cap = getCap(env);
  if (!env.POSTS_CACHE) return { over: false, count: 0, cap };
  try {
    const raw = await env.POSTS_CACHE.get(dayKey());
    const count = raw ? Number(raw) : 0;
    const safe = Number.isFinite(count) ? count : 0;
    return { over: safe >= cap, count: safe, cap };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    log('br.cap.counter_failed', reqId, 'warn', env, {
      type: 'read',
      reason,
      stack,
    });
    return { over: false, count: 0, cap };
  }
}

/**
 * Read-modify-write. Concurrent requests can race and undercount by a few;
 * acceptable — the cap is approximate. Fired through `ctx.waitUntil` so the
 * main response isn't blocked on the KV round-trip.
 */
export function recordBRCall(
  env: Env,
  ctx: ExecutionContext,
  reqId: string,
): void {
  if (!env.POSTS_CACHE) return;
  const kv = env.POSTS_CACHE;
  const key = dayKey();
  ctx.waitUntil(
    (async () => {
      try {
        const raw = await kv.get(key);
        const prev = raw ? Number(raw) : 0;
        const next = Number.isFinite(prev) ? prev + 1 : 1;
        await kv.put(key, String(next), {
          expirationTtl: COUNTER_TTL_SECONDS,
        });
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        const stack = e instanceof Error ? e.stack : undefined;
        log('br.cap.counter_failed', reqId, 'warn', env, {
          type: 'write',
          reason,
          stack,
        });
      }
    })(),
  );
}
