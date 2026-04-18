import type { Context } from 'hono';
import type { Env } from '../env';
import { getData } from '../scraper';

export async function imagesHandler(
  c: Context<{ Bindings: Env }>,
): Promise<Response> {
  const postID = c.req.param('postID') ?? '';
  const mediaNum = Number.parseInt(c.req.param('mediaNum') ?? '1', 10);
  if (!Number.isFinite(mediaNum)) return c.text('invalid mediaNum', 400);

  const data = await getData(postID, 'p', c.env, c.executionCtx);
  if (!data || mediaNum > data.Medias.length) return c.notFound();

  const media = data.Medias[Math.max(1, mediaNum) - 1];
  if (!media) return c.notFound();
  return c.redirect(media.URL, 302);
}
