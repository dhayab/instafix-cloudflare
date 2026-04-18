import type { Context } from 'hono';

export function oembedHandler(c: Context): Response {
  const text = c.req.query('text');
  const url = c.req.query('url');
  if (!text || !url) return new Response(null, { status: 204 });

  const body = {
    author_name: text,
    author_url: url,
    provider_name: 'InstaFix',
    provider_url: 'https://github.com/Wikidepia/InstaFix',
    title: 'Instagram',
    type: 'link',
    version: '1.0',
  };
  return c.json(body);
}
