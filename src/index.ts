import { Hono } from 'hono';
import type { Env } from './env';
import { log } from './utils/log';
import { isBot } from './utils/bot';
import { embedHandler } from './handlers/embed';
import { imagesHandler } from './handlers/images';
import { videosHandler } from './handlers/videos';
import { gridHandler } from './handlers/grid';
import { oembedHandler } from './handlers/oembed';
import { homeHandler } from './handlers/home';
import { faviconHandler } from './handlers/favicon';
import { thumbnailHandler } from './handlers/thumbnails';

export type RequestOutcome =
  | 'ok'
  | 'bot_redirect'
  | 'direct_redirect'
  | 'not_found'
  | 'invalid_input'
  | 'out_of_range'
  | 'scrape_failed'
  | 'compose_failed'
  | 'unhandled_error';

export interface RequestMetadata {
  handler?: string;
  outcome: RequestOutcome;
  [key: string]: unknown;
}

export type AppBindings = {
  Bindings: Env;
  Variables: { reqId: string; metadata: RequestMetadata };
};

const app = new Hono<AppBindings>();

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

// MUST be registered AFTER the trailing-slash rewriter. The rewriter
// recursively calls app.fetch for the cleaned URL; if logging ran first,
// every trailing-slash request would emit duplicate lifecycle events.
app.use(async (c, next) => {
  const reqId = c.req.header('cf-ray') ?? crypto.randomUUID();
  c.set('reqId', reqId);
  c.set('metadata', { outcome: 'unhandled_error' });

  const url = new URL(c.req.url);
  const ua = c.req.header('User-Agent') ?? '';
  const started = Date.now();

  log('request.start', reqId, 'info', c.env, {
    method: c.req.method,
    path: url.pathname,
    ua,
    isBot: isBot(ua),
    host: url.host,
  });

  try {
    await next();
  } finally {
    const metadata = c.get('metadata');
    const status = c.res?.status ?? 500;
    log('request.done', reqId, 'info', c.env, {
      status,
      durationMs: Date.now() - started,
      ...metadata,
    });
  }
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
