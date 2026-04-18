import type { Env } from '../env';
import type { Media } from './types';
import { log } from '../utils/log';
import { getBRCapState, recordBRCall } from './br-cap';

interface ImageCandidate {
  width?: number;
  height?: number;
  url: string;
}

interface VideoVersion {
  width?: number;
  height?: number;
  url: string;
}

interface CarouselItem {
  pk?: string;
  id?: string;
  original_width?: number;
  original_height?: number;
  image_versions2?: { candidates?: ImageCandidate[] };
  video_versions?: VideoVersion[];
}

export interface BRResult {
  medias: Media[];
  width: number;
  height: number;
  caption?: string;
  username?: string;
}

/**
 * Extract a balanced JSON array literal `[...]` that follows `"key":` at the
 * first occurrence in the source at or after `startAt`. Handles nested
 * brackets and string-escape sequences so that brackets inside strings don't
 * confuse the depth counter.
 */
function extractJSONArray(
  source: string,
  key: string,
  startAt = 0,
): string | null {
  const needle = `"${key}":`;
  const i = source.indexOf(needle, startAt);
  if (i < 0) return null;
  let start = i + needle.length;
  while (start < source.length && /\s/.test(source[start]!)) start++;
  if (source[start] !== '[') return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let j = start; j < source.length; j++) {
    const c = source[j]!;
    if (escape) {
      escape = false;
      continue;
    }
    if (c === '\\') {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) return source.slice(start, j + 1);
    }
  }
  return null;
}

function bestImageCandidate(item: CarouselItem): ImageCandidate | null {
  const cands = item.image_versions2?.candidates ?? [];
  if (!cands.length) return null;
  let best = cands[0]!;
  for (const c of cands) {
    if (
      (c.width ?? 0) * (c.height ?? 0) >
      (best.width ?? 0) * (best.height ?? 0)
    )
      best = c;
  }
  return best;
}

function bestVideoVersion(item: CarouselItem): VideoVersion | null {
  const versions = item.video_versions ?? [];
  if (!versions.length) return null;
  let best = versions[0]!;
  for (const v of versions) {
    if (
      (v.width ?? 0) * (v.height ?? 0) >
      (best.width ?? 0) * (best.height ?? 0)
    )
      best = v;
  }
  return best;
}

function carouselItemToMedia(item: CarouselItem): Media | null {
  const video = bestVideoVersion(item);
  if (video) {
    return {
      TypeName: 'GraphVideo',
      URL: video.url,
      Width: video.width ?? item.original_width,
      Height: video.height ?? item.original_height,
    };
  }
  const image = bestImageCandidate(item);
  if (image) {
    return {
      TypeName: 'GraphImage',
      URL: image.url,
      Width: image.width ?? item.original_width,
      Height: image.height ?? item.original_height,
    };
  }
  return null;
}

async function probeContentLength(url: string): Promise<number | undefined> {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    if (!res.ok) return undefined;
    const cl = res.headers.get('content-length');
    if (!cl) return undefined;
    const n = Number(cl);
    return Number.isFinite(n) ? n : undefined;
  } catch {
    return undefined;
  }
}

type FetchHTMLResult =
  | {
      ok: true;
      html: string;
      outcome: 'ok';
      capCount: number;
      cap: number;
    }
  | { ok: false; outcome: 'disabled' }
  | {
      ok: false;
      outcome: 'skipped_over_cap';
      capCount: number;
      cap: number;
    }
  | {
      ok: false;
      outcome: 'failed';
      type: 'fetch' | 'http' | 'response_invalid';
      status?: number;
      reason?: string;
      stack?: string;
      capCount: number;
      cap: number;
    };

async function fetchRenderedHTML(
  postID: string,
  kind: 'reel' | 'tv' | 'p',
  env: Env,
  ctx: ExecutionContext,
  reqId: string,
): Promise<FetchHTMLResult> {
  if (!env.CF_ACCOUNT_ID || !env.CF_BROWSER_API_TOKEN) {
    return { ok: false, outcome: 'disabled' };
  }

  const capState = await getBRCapState(env, reqId);
  if (capState.over) {
    return {
      ok: false,
      outcome: 'skipped_over_cap',
      capCount: capState.count,
      cap: capState.cap,
    };
  }

  recordBRCall(env, ctx, reqId);

  const postURL = `https://www.instagram.com/${kind}/${encodeURIComponent(postID)}/`;

  let res: Response;
  try {
    res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/browser-rendering/content`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.CF_BROWSER_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: postURL }),
      },
    );
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    return {
      ok: false,
      outcome: 'failed',
      type: 'fetch',
      reason,
      stack,
      capCount: capState.count,
      cap: capState.cap,
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      outcome: 'failed',
      type: 'http',
      status: res.status,
      capCount: capState.count,
      cap: capState.cap,
    };
  }

  let body: { success: boolean; result?: string };
  try {
    body = (await res.json()) as { success: boolean; result?: string };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    return {
      ok: false,
      outcome: 'failed',
      type: 'response_invalid',
      reason,
      stack,
      capCount: capState.count,
      cap: capState.cap,
    };
  }
  if (!body.success || !body.result) {
    return {
      ok: false,
      outcome: 'failed',
      type: 'response_invalid',
      capCount: capState.count,
      cap: capState.cap,
    };
  }
  return {
    ok: true,
    html: body.result,
    outcome: 'ok',
    capCount: capState.count,
    cap: capState.cap,
  };
}

/**
 * Anchor extraction to the requested post, since IG's SPA HTML embeds
 * multiple posts' JSON (main + sidebar/suggested). Search for the post's own
 * shortcode first; start the `carousel_media`/`video_versions` scan from that
 * offset so we never grab a related post's array. Returns 0 if the shortcode
 * isn't found, which falls back to whole-document first-match.
 */
function locatePostAnchor(source: string, postID: string): number {
  const shortcodeAt = source.indexOf(`"shortcode":"${postID}"`);
  const codeAt = source.indexOf(`"code":"${postID}"`);
  if (shortcodeAt < 0 && codeAt < 0) return 0;
  if (shortcodeAt < 0) return codeAt;
  if (codeAt < 0) return shortcodeAt;
  return Math.min(shortcodeAt, codeAt);
}

/**
 * Scrape the rendered HTML for full post media. Returns one Media entry per
 * carousel item (or a single entry for non-carousel posts). If parsing fails
 * or BR is unavailable, returns null so the caller can fall back to oembed.
 */
export async function scrapeViaBrowser(
  postID: string,
  kind: 'reel' | 'tv' | 'p',
  env: Env,
  ctx: ExecutionContext,
  reqId: string,
): Promise<BRResult | null> {
  const started = Date.now();
  const fetched = await fetchRenderedHTML(postID, kind, env, ctx, reqId);

  if (!fetched.ok) {
    const level = fetched.outcome === 'disabled' ? 'info' : 'warn';
    const payload: Record<string, unknown> = {
      postID,
      outcome: fetched.outcome,
      durationMs: Date.now() - started,
    };
    if (fetched.outcome !== 'disabled') {
      payload.capCount = fetched.capCount;
      payload.cap = fetched.cap;
    }
    if (fetched.outcome === 'failed') {
      payload.type = fetched.type;
      payload.status = fetched.status;
      payload.reason = fetched.reason;
      payload.stack = fetched.stack;
    }
    log('scraper.br', reqId, level, env, payload);
    if (fetched.outcome === 'skipped_over_cap') {
      log('br.cap.over', reqId, 'warn', env, {
        count: fetched.capCount,
        cap: fetched.cap,
      });
    }
    return null;
  }

  const html = fetched.html;
  const anchor = locatePostAnchor(html, postID);
  if (anchor === 0) {
    log('scraper.br', reqId, 'warn', env, {
      postID,
      outcome: 'failed',
      type: 'anchor_missing',
      terminal: false,
      capCount: fetched.capCount,
      cap: fetched.cap,
      durationMs: Date.now() - started,
    });
    // Fall through: anchor=0 is a soft signal. The rest of the pipeline
    // can still recover if the first JSON match happens to be the right
    // post. We warn and keep going rather than returning null here.
  }

  const carouselText = extractJSONArray(html, 'carousel_media', anchor);
  if (carouselText) {
    let items: CarouselItem[];
    try {
      items = JSON.parse(carouselText) as CarouselItem[];
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      const stack = e instanceof Error ? e.stack : undefined;
      log('scraper.br', reqId, 'warn', env, {
        postID,
        outcome: 'failed',
        type: 'carousel_parse',
        capCount: fetched.capCount,
        cap: fetched.cap,
        durationMs: Date.now() - started,
        reason,
        stack,
      });
      return null;
    }
    const medias: Media[] = [];
    let width = 0;
    let height = 0;
    for (const item of items) {
      const m = carouselItemToMedia(item);
      if (!m) continue;
      medias.push(m);
      if (
        (item.original_width ?? 0) * (item.original_height ?? 0) >
        width * height
      ) {
        width = item.original_width ?? 0;
        height = item.original_height ?? 0;
      }
    }
    if (!medias.length) {
      log('scraper.br', reqId, 'warn', env, {
        postID,
        outcome: 'failed',
        type: 'no_match',
        shape: 'carousel',
        capCount: fetched.capCount,
        cap: fetched.cap,
        durationMs: Date.now() - started,
      });
      return null;
    }
    log('scraper.br', reqId, 'info', env, {
      postID,
      outcome: 'ok',
      shape: 'carousel',
      mediaCount: medias.length,
      capCount: fetched.capCount,
      cap: fetched.cap,
      durationMs: Date.now() - started,
    });
    return { medias, width, height };
  }

  const videoText = extractJSONArray(html, 'video_versions', anchor);
  if (videoText) {
    let versions: VideoVersion[];
    try {
      versions = JSON.parse(videoText) as VideoVersion[];
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      const stack = e instanceof Error ? e.stack : undefined;
      log('scraper.br', reqId, 'warn', env, {
        postID,
        outcome: 'failed',
        type: 'video_parse',
        capCount: fetched.capCount,
        cap: fetched.cap,
        durationMs: Date.now() - started,
        reason,
        stack,
      });
      return null;
    }
    if (!versions.length) {
      log('scraper.br', reqId, 'warn', env, {
        postID,
        outcome: 'failed',
        type: 'no_match',
        shape: 'video',
        capCount: fetched.capCount,
        cap: fetched.cap,
        durationMs: Date.now() - started,
      });
      return null;
    }
    versions.sort(
      (a, b) =>
        (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0),
    );
    const best = versions[0]!;
    if (!best.url) {
      log('scraper.br', reqId, 'warn', env, {
        postID,
        outcome: 'failed',
        type: 'no_match',
        shape: 'video',
        capCount: fetched.capCount,
        cap: fetched.cap,
        durationMs: Date.now() - started,
      });
      return null;
    }
    const contentLength = await probeContentLength(best.url);
    log('scraper.br', reqId, 'info', env, {
      postID,
      outcome: 'ok',
      shape: 'video',
      mediaCount: 1,
      capCount: fetched.capCount,
      cap: fetched.cap,
      durationMs: Date.now() - started,
    });
    return {
      medias: [
        {
          TypeName: 'GraphVideo',
          URL: best.url,
          Width: best.width,
          Height: best.height,
          ContentLength: contentLength,
        },
      ],
      width: best.width ?? 0,
      height: best.height ?? 0,
    };
  }

  log('scraper.br', reqId, 'warn', env, {
    postID,
    outcome: 'failed',
    type: 'no_match',
    capCount: fetched.capCount,
    cap: fetched.cap,
    durationMs: Date.now() - started,
  });
  return null;
}
