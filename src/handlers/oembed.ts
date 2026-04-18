import type { Context } from 'hono';
import type { AppBindings } from '../index';

export function oembedHandler(c: Context<AppBindings>): Response {
  const text = c.req.query('text');
  const url = c.req.query('url');
  if (!text || !url) {
    c.set('metadata', { handler: 'oembed', outcome: 'invalid_input' });
    return new Response(null, { status: 204 });
  }

  const body = {
    author_name: text,
    author_url: url,
    provider_name: 'InstaFix',
    provider_url: 'https://github.com/Wikidepia/InstaFix',
    title: 'Instagram',
    type: 'link',
    version: '1.0',
  };
  c.set('metadata', { handler: 'oembed', outcome: 'ok' });
  return c.json(body);
}
