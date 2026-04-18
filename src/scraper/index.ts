import type { Env } from '../env';
import type { InstaData } from './types';
import { log } from '../utils/log';
import { scrapeFromOEmbed } from './oembed';
import { scrapeViaBrowser } from './browser';

const VALID_PREFIX = /^[CDB]/;
const KV_TTL_SECONDS = 24 * 60 * 60;

export type PostKind = 'p' | 'reel' | 'reels' | 'tv';

const inflight = new Map<string, Promise<InstaData | null>>();

function normalizeKind(kind: PostKind): 'p' | 'reel' | 'tv' {
  return kind === 'reels' ? 'reel' : kind;
}

function kvKey(postID: string, kind: PostKind): string {
  return `post:v4:${normalizeKind(kind)}:${postID}`;
}

export async function getData(
  postID: string,
  kind: PostKind,
  env: Env,
  ctx: ExecutionContext,
  reqId: string,
): Promise<InstaData | null> {
  if (!VALID_PREFIX.test(postID)) {
    throw new Error('postID is not a valid Instagram post ID');
  }

  const started = Date.now();
  const key = kvKey(postID, kind);

  if (env.POSTS_CACHE) {
    const cached = (await env.POSTS_CACHE.get(key, 'json')) as InstaData | null;
    if (cached?.Medias?.length) {
      log('scraper.done', reqId, 'info', env, {
        postID,
        kind,
        source: 'cache',
        coalesced: false,
        mediaCount: cached.Medias.length,
        hasOembed: false,
        hasBr: false,
        durationMs: Date.now() - started,
      });
      return cached;
    }
  }

  const existing = inflight.get(key);
  if (existing) {
    const data = await existing;
    log('scraper.done', reqId, 'info', env, {
      postID,
      kind,
      source: 'scrape',
      coalesced: true,
      mediaCount: data?.Medias.length ?? 0,
      hasOembed: false,
      hasBr: false,
      durationMs: Date.now() - started,
    });
    return data;
  }

  const p = scrape(postID, kind, env, ctx, reqId)
    .then(async (data) => {
      if (data?.Medias?.length && env.POSTS_CACHE) {
        ctx.waitUntil(
          env.POSTS_CACHE.put(key, JSON.stringify(data), {
            expirationTtl: KV_TTL_SECONDS,
          }),
        );
      }
      return data;
    })
    .finally(() => inflight.delete(key));

  inflight.set(key, p);
  const data = await p;
  log('scraper.done', reqId, 'info', env, {
    postID,
    kind,
    source: 'scrape',
    coalesced: false,
    mediaCount: data?.Medias.length ?? 0,
    hasOembed: Boolean(data?.Caption || data?.Thumbnail),
    hasBr: Boolean(data && (data.Width || data.Height)),
    durationMs: Date.now() - started,
  });
  return data;
}

/**
 * Strategy: run oembed and Browser Rendering in parallel. Oembed is fast and
 * reliable for caption + username; BR gives us the full carousel / video URL.
 * Merge the two so we always have the best information available.
 */
async function scrape(
  postID: string,
  kind: PostKind,
  env: Env,
  ctx: ExecutionContext,
  reqId: string,
): Promise<InstaData | null> {
  const normalized = normalizeKind(kind);
  const [oembed, br] = await Promise.all([
    scrapeFromOEmbed(postID, env, reqId),
    scrapeViaBrowser(postID, normalized, env, ctx, reqId),
  ]);

  if (!oembed && !br) return null;

  const data: InstaData = {
    PostID: postID,
    Username: oembed?.Username ?? br?.username ?? '',
    Caption: oembed?.Caption ?? br?.caption ?? '',
    Medias: br?.medias.length ? br.medias : (oembed?.Medias ?? []),
  };
  if (br?.width) data.Width = br.width;
  if (br?.height) data.Height = br.height;
  if (oembed?.Thumbnail) data.Thumbnail = oembed.Thumbnail;

  if (!data.Medias.length || !data.Username) return null;
  return data;
}
