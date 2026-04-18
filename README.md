# instafix-cloudflare

Rich OpenGraph / Twitter-Card previews for Instagram URLs, running on Cloudflare Workers. Swap `instagram.com` for your worker's hostname in any Instagram link and chat apps (Discord, Telegram, …) will unfurl it as a proper preview.

```
https://www.instagram.com/p/DXPmUf9jf4l/

              ↓  swap the host

https://example-domain.workers.dev/p/DXPmUf9jf4l/
```

## Supported URL shapes

| Content         | Pattern                              |
| --------------- | ------------------------------------ |
| Image           | `/p/:postID`                         |
| Carousel (grid) | `/p/:postID`, `/p/:postID/:mediaNum` |
| Reel            | `/reel/:postID`                      |
| Story           | `/stories/:username/:postID`         |

See [docs/SPEC.md](docs/SPEC.md) for the full route contract, username-prefixed variants, and query switches.

## Deploy with Wrangler

```bash
npm install

# Create shared-namespace resources
wrangler kv namespace create instafix-posts-cache
wrangler r2 bucket create instafix-grids

# Replace the placeholder `id` on the POSTS_CACHE binding in wrangler.toml
# with the KV namespace id printed above.

# Set Browser Rendering secrets
wrangler secret put CF_ACCOUNT_ID
wrangler secret put CF_BROWSER_API_TOKEN   # scope: "Browser Rendering - Edit"

wrangler deploy
```

Both secrets are required for reels and carousels — without them, the scraper silently falls back to oembed-only, which can only resolve single-image posts. See [docs/SPEC.md](docs/SPEC.md#secrets) for details.

Point your domain at the Worker via the Cloudflare dashboard (Workers Routes or a custom domain). No additional DNS work is needed if you use a `*.workers.dev` subdomain.

## Local development

```bash
npm install
npm run dev
```

To exercise the Browser Rendering tier locally, put the secrets in a `.dev.vars` file at the repo root:

```
CF_ACCOUNT_ID=…
CF_BROWSER_API_TOKEN=…
```

Without it, `npm run dev` still boots but reels and carousels won't resolve.

## Architecture

TypeScript + [Hono](https://hono.dev) on Workers. Full topology, request flows, and design decisions: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Credits

Original Go implementation by [Wikidepia/InstaFix](https://github.com/Wikidepia/InstaFix). Ported and rewritten in TypeScript for the Cloudflare Workers runtime.
