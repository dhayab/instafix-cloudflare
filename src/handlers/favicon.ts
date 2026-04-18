import type { Context } from 'hono';
import type { AppBindings } from '../index';

const EMPTY_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>';

export function faviconHandler(c: Context<AppBindings>): Response {
  c.set('metadata', { handler: 'favicon', outcome: 'ok' });
  return new Response(EMPTY_SVG, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
