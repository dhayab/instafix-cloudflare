import type { Context } from 'hono';
import type { AppBindings } from '../index';

const HOME_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title> </title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; }
  body {
    min-height: 100dvh;
    background: #111;
    color: #c9c9c9;
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
    font-size: 15px;
    line-height: 1.7;
    display: grid;
    place-items: center;
    padding: 2rem 1.5rem;
    -webkit-font-smoothing: antialiased;
  }
  main {
    max-width: 38rem;
    width: 100%;
    text-align: justify;
    text-align-last: left;
    hyphens: auto;
  }
  p { margin: 0 0 1.25rem; }
  p:first-child, p:last-child { color: #7a7a7a; }
  p:last-child { margin-bottom: 0; }
  strong { color: #e8e8e8; font-weight: 600; }
</style>
</head>
<body>
<main>
  <p>This service is an independent, unofficial tool provided on an &ldquo;as is&rdquo; basis, without warranty of any kind, express or implied, including but not limited to merchantability, fitness for a particular purpose, and non-infringement.</p>
  <p>This service is <strong>not affiliated with, endorsed by, sponsored by, or otherwise associated with Instagram, LLC, Meta Platforms, Inc., or any of their subsidiaries or affiliates</strong>. &ldquo;Instagram&rdquo; and all related names, logos, product and service names, designs, and slogans are trademarks of Instagram, LLC. All content accessed through this service remains the property of its respective owners.</p>
  <p>No user data is stored beyond short-lived technical caches used to reduce load on upstream services.</p>
</main>
</body>
</html>`;

export function homeHandler(c: Context<AppBindings>): Response {
  c.set('metadata', { handler: 'home', outcome: 'ok' });
  return c.html(HOME_HTML, 200, {
    'Cache-Control': 'public, max-age=86400, immutable',
  });
}
