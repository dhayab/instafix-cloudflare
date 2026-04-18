import type { Context } from 'hono';
import type { AppBindings } from '../index';
import { getData } from '../scraper';
import { composeGrid, type GridInput } from '../grid/compose';

const inflight = new Map<string, Promise<Uint8Array>>();

function r2Key(postID: string): string {
  return `grids/${postID}.jpg`;
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

export async function gridHandler(c: Context<AppBindings>): Promise<Response> {
  const postID = c.req.param('postID') ?? '';
  const reqId = c.get('reqId');

  const key = r2Key(postID);
  if (c.env.GRIDS) {
    const cached = await c.env.GRIDS.get(key);
    if (cached) return respondJpeg(await cached.arrayBuffer());
  }

  const data = await getData(postID, 'p', c.env, c.executionCtx, reqId);
  if (!data) return c.notFound();

  const imageItems: GridInput[] = data.Medias.filter((m) =>
    m.TypeName.includes('Image'),
  )
    .map((m) => ({
      url: m.URL,
      width: m.Width ?? 0,
      height: m.Height ?? 0,
    }))
    .filter((i) => i.width > 0 && i.height > 0);

  if (imageItems.length === 0) return c.notFound();
  if (imageItems.length === 1) {
    return c.redirect(`/images/${postID}/1`, 302);
  }

  const existing = inflight.get(postID);
  const work =
    existing ??
    composeGrid(imageItems).finally(() => {
      inflight.delete(postID);
    });
  if (!existing) inflight.set(postID, work);

  let jpeg: Uint8Array;
  try {
    jpeg = await work;
  } catch {
    return c.text('grid compose failed', 500);
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
