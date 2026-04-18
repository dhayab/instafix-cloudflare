import { Hono } from 'hono';
import type { Env } from './env';
import { embedHandler } from './handlers/embed';
import { imagesHandler } from './handlers/images';
import { videosHandler } from './handlers/videos';
import { gridHandler } from './handlers/grid';
import { oembedHandler } from './handlers/oembed';
import { homeHandler } from './handlers/home';
import { faviconHandler } from './handlers/favicon';
import { thumbnailHandler } from './handlers/thumbnails';

const app = new Hono<{ Bindings: Env }>();

// Rewrite trailing slashes internally instead of issuing a 301 redirect.
// Instagram share links carry a trailing slash, and many chat-preview
// scrapers (Twitter, some Discord/Telegram paths) don't follow 301 for
// unfurls, so they'd silently drop the request.
app.use(async (c, next) => {
  const url = new URL(c.req.url);
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    const cleaned = url.pathname.replace(/\/+$/, '');
    const rewritten = url.origin + cleaned + url.search;
    return app.fetch(new Request(rewritten, c.req.raw), c.env, c.executionCtx);
  }
  return next();
});

app.get('/', homeHandler);
app.get('/favicon.ico', faviconHandler);
app.get('/oembed', oembedHandler);

app.get('/images/:postID/:mediaNum', imagesHandler);
app.get('/videos/:postID/:mediaNum', videosHandler);
app.get('/grid/:postID', gridHandler);
app.get('/thumbnails/:postID', thumbnailHandler);

app.get('/tv/:postID', embedHandler);
app.get('/reel/:postID', embedHandler);
app.get('/reels/:postID', embedHandler);
app.get('/stories/:username/:postID', embedHandler);
app.get('/share/reel/:postID', embedHandler);

app.get('/p/:postID', embedHandler);
app.get('/p/:postID/:mediaNum', embedHandler);

app.get('/:username/p/:postID', embedHandler);
app.get('/:username/p/:postID/:mediaNum', embedHandler);
app.get('/:username/reel/:postID', embedHandler);

export default app;
