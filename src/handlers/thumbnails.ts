import type { Context } from 'hono';
import { PhotonImage } from '@cf-wasm/photon';
import type { AppBindings } from '../index';
import { getData } from '../scraper';
import { drawPlayIcon } from '../grid/play-icon';

const inflight = new Map<string, Promise<Uint8Array>>();

function r2Key(postID: string): string {
  return `thumbnails/${postID}-play.jpg`;
}

function respondJpeg(bytes: ArrayBuffer | Uint8Array): Response {
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=86400, immutable',
    },
  });
}

async function composePlayThumbnail(url: string): Promise<Uint8Array> {
  const res = await fetch(url, {
    headers: { Accept: 'image/jpeg,image/webp,image/*;q=0.8' },
  });
  if (!res.ok) throw new Error(`thumbnail fetch HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());

  const source = PhotonImage.new_from_byteslice(bytes);
  const width = source.get_width();
  const height = source.get_height();
  const pixels = source.get_raw_pixels();
  source.free();

  drawPlayIcon(pixels, width, height);

  const canvas = new PhotonImage(pixels, width, height);
  const jpeg = canvas.get_bytes_jpeg(82);
  canvas.free();
  return jpeg;
}

/**
 * Serves a video poster thumbnail with a play-icon overlay. Used as
 * `og:image` when a reel exceeds Telegram's inline-video size cap —
 * gives users a visual cue that the preview still represents a video.
 */
export async function thumbnailHandler(
  c: Context<AppBindings>,
): Promise<Response> {
  const postID = c.req.param('postID') ?? '';
  const reqId = c.get('reqId');

  const key = r2Key(postID);
  if (c.env.GRIDS) {
    const cached = await c.env.GRIDS.get(key);
    if (cached) return respondJpeg(await cached.arrayBuffer());
  }

  const data = await getData(postID, 'p', c.env, c.executionCtx, reqId);
  if (!data?.Thumbnail) return c.notFound();

  const existing = inflight.get(postID);
  const work =
    existing ??
    composePlayThumbnail(data.Thumbnail).finally(() => {
      inflight.delete(postID);
    });
  if (!existing) inflight.set(postID, work);

  let jpeg: Uint8Array;
  try {
    jpeg = await work;
  } catch {
    return c.redirect(data.Thumbnail, 302);
  }

  if (c.env.GRIDS) {
    c.executionCtx.waitUntil(
      c.env.GRIDS.put(key, jpeg, {
        httpMetadata: { contentType: 'image/jpeg' },
      }),
    );
  }

  return respondJpeg(jpeg);
}
