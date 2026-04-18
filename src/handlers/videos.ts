import type { Context } from 'hono';
import type { AppBindings } from '../index';
import { getData } from '../scraper';

export async function videosHandler(
  c: Context<AppBindings>,
): Promise<Response> {
  const postID = c.req.param('postID') ?? '';
  const reqId = c.get('reqId');
  const mediaNum = Number.parseInt(c.req.param('mediaNum') ?? '1', 10);
  if (!Number.isFinite(mediaNum)) return c.text('invalid mediaNum', 400);

  const data = await getData(postID, 'reel', c.env, c.executionCtx, reqId);
  if (!data || mediaNum > data.Medias.length) return c.notFound();

  const media = data.Medias[Math.max(1, mediaNum) - 1];
  if (!media) return c.notFound();
  return c.redirect(media.URL, 302);
}
