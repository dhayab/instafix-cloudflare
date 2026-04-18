import type { Context } from 'hono';
import type { AppBindings } from '../index';
import { getData } from '../scraper';

export async function imagesHandler(
  c: Context<AppBindings>,
): Promise<Response> {
  const postID = c.req.param('postID') ?? '';
  const reqId = c.get('reqId');
  const mediaNum = Number.parseInt(c.req.param('mediaNum') ?? '1', 10);
  if (!Number.isFinite(mediaNum)) {
    c.set('metadata', {
      handler: 'images',
      outcome: 'invalid_input',
      invalidReason: 'mediaNum',
      postID,
    });
    return c.text('invalid mediaNum', 400);
  }

  const data = await getData(postID, 'p', c.env, c.executionCtx, reqId);
  if (!data || mediaNum > data.Medias.length) {
    c.set('metadata', {
      handler: 'images',
      outcome: !data ? 'not_found' : 'out_of_range',
      postID,
      mediaNum,
    });
    return c.notFound();
  }

  const media = data.Medias[Math.max(1, mediaNum) - 1];
  if (!media) {
    c.set('metadata', {
      handler: 'images',
      outcome: 'out_of_range',
      postID,
      mediaNum,
    });
    return c.notFound();
  }

  c.set('metadata', {
    handler: 'images',
    outcome: 'ok',
    postID,
    mediaNum,
  });
  return c.redirect(media.URL, 302);
}
