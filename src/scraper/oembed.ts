import type { Env } from '../env';
import type { InstaData } from './types';
import { log } from '../utils/log';

const IG_APP_ID = '936619743392459';
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

interface OEmbedResponse {
  title?: string;
  author_name?: string;
  author_url?: string;
  thumbnail_url?: string;
  thumbnail_width?: number;
  thumbnail_height?: number;
  type?: string;
}

export async function scrapeFromOEmbed(
  postID: string,
  env: Env,
  reqId: string,
): Promise<InstaData | null> {
  const started = Date.now();
  const postURL = `https://www.instagram.com/p/${encodeURIComponent(postID)}/`;
  const url = `https://www.instagram.com/api/v1/oembed/?url=${encodeURIComponent(postURL)}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        'X-Ig-App-Id': IG_APP_ID,
        Accept: 'application/json',
        'User-Agent': BROWSER_UA,
      },
    });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    log('scraper.oembed', reqId, 'warn', env, {
      postID,
      outcome: 'failed',
      type: 'fetch',
      durationMs: Date.now() - started,
      reason,
      stack,
    });
    return null;
  }

  if (!res.ok) {
    log('scraper.oembed', reqId, 'warn', env, {
      postID,
      outcome: 'failed',
      type: 'http',
      status: res.status,
      durationMs: Date.now() - started,
    });
    return null;
  }

  let body: OEmbedResponse;
  try {
    body = (await res.json()) as OEmbedResponse;
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    log('scraper.oembed', reqId, 'warn', env, {
      postID,
      outcome: 'failed',
      type: 'parse',
      durationMs: Date.now() - started,
      reason,
      stack,
    });
    return null;
  }

  if (!body.thumbnail_url || !body.author_name) {
    log('scraper.oembed', reqId, 'warn', env, {
      postID,
      outcome: 'failed',
      type: 'incomplete',
      durationMs: Date.now() - started,
    });
    return null;
  }

  log('scraper.oembed', reqId, 'info', env, {
    postID,
    outcome: 'ok',
    durationMs: Date.now() - started,
  });

  return {
    PostID: postID,
    Username: body.author_name,
    Caption: (body.title ?? '').trim(),
    Medias: [{ TypeName: 'GraphImage', URL: body.thumbnail_url }],
    Thumbnail: body.thumbnail_url,
  };
}
