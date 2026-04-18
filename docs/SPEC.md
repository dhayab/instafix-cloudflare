# Spec

Contract for the Worker — routes, inputs, responses, bindings, secrets.

## Routes

### Embed routes (render OG/Twitter HTML)

All accept the same query params and header overrides. Bot User-Agents get the embed HTML; non-bot UAs get a 302 redirect to the real `instagram.com` URL.

| Pattern | Notes |
| --- | --- |
| `/p/:postID` | Single image, carousel (emits `og:image=/grid/…` when >1), or single video |
| `/p/:postID/:mediaNum` | Pins a specific item in a carousel |
| `/reel/:postID`, `/reels/:postID`, `/tv/:postID` | Video posts |
| `/stories/:username/:postID` | `postID` is the numeric `mediaID`; decoded to shortcode via base-64-like alphabet |
| `/share/reel/:postID` | `postID` is a short blob; HEAD to `instagram.com/share/reel/:id/`, unwrap `Location` |
| `/:username/p/:postID`, `/:username/p/:postID/:mediaNum`, `/:username/reel/:postID` | Username-prefixed variants |

**Query / header switches:**

- `?direct=true` or `X-Embed-Type: direct` → 302 to the underlying media URL
- `?gallery=true` or `X-Embed-Type: gallery` → suppress caption
- `?img_index=N` → same as `:mediaNum`
- Any other query param is ignored (including `?igsh=…` tracking params and cache-busting `?v=...`)

### Media routes (302 to IG CDN)

| Pattern | Returns |
| --- | --- |
| `/images/:postID/:mediaNum` | 302 to the Nth image CDN URL |
| `/videos/:postID/:mediaNum` | 302 to the Nth video CDN URL |
| `/grid/:postID` | Pre-composited JPEG (carousel), R2-cached |
| `/thumbnails/:postID` | JPEG thumbnail with play-icon overlay for video posts |

### Static routes

| Pattern              | Returns                                     |
| -------------------- | ------------------------------------------- |
| `/`                  | Disclaimer-only HTML page (`max-age=86400`) |
| `/favicon.ico`       | 1×1 transparent SVG (`max-age=31536000`)    |
| `/oembed?text=&url=` | JSON oEmbed metadata for video players      |

## Response headers

- Embed HTML: default (no explicit cache; chat scrapers cache per their own rules)
- Home / favicon: `Cache-Control: public, max-age=…, immutable`
- Grid JPEG / thumbnail JPEG: `Cache-Control: public, max-age=86400, immutable`

## Trailing slashes

The root-level middleware in [src/index.ts](../src/index.ts) rewrites URLs internally — `/reel/abc/` is served identically to `/reel/abc` with no HTTP redirect. Important because Instagram share links always include a trailing slash and many chat scrapers drop previews on 3xx responses.

## Bindings

Declared in [wrangler.toml](../wrangler.toml). Convention: every shared-namespace resource is prefixed `instafix-`. The Worker-local binding name stays short.

| Binding | Kind | Resource name | Role |
| --- | --- | --- | --- |
| `POSTS_CACHE` | KV namespace | `instafix-posts-cache` | `post:v4:{kind}:{postID}` → `InstaData` JSON, TTL 86 400 s |
| `GRIDS` | R2 bucket | `instafix-grids` | `grids/{id}.jpg` + `thumbnails/{id}-play.jpg`, 30-day lifecycle |
| `IMAGES` | Cloudflare Images | — | Reserved for future offload; currently unused |

Both resources are provisioned by Terraform ([terraform/](../terraform/)). The KV id is committed into [wrangler.toml](../wrangler.toml) (public identifier, not sensitive) so `wrangler deploy` ships the Worker with no templating step. Local dev uses file-backed state under `.wrangler/state/…` regardless of the id.

## Secrets

Set via `wrangler secret put` (or `.dev.vars` for local development):

| Secret | Purpose |
| --- | --- |
| `CF_ACCOUNT_ID` | Cloudflare account id for Browser Rendering REST API |
| `CF_BROWSER_API_TOKEN` | API token with `Browser Rendering - Edit` permission |

If either secret is missing, the scraper silently skips Browser Rendering and falls back to oembed-only (works for single-image posts; fails for reels and carousels).

## Data model

```ts
interface Media {
  TypeName: string; // 'GraphImage' | 'GraphVideo'
  URL: string; // IG CDN URL
  Width?: number;
  Height?: number;
  ContentLength?: number; // videos only; populated via HEAD
}

interface InstaData {
  PostID: string;
  Username: string;
  Caption: string;
  Medias: Media[];
  Width?: number; // max dimensions across all carousel items
  Height?: number;
  Thumbnail?: string; // oembed thumbnail_url (poster frame for videos)
}
```

## Configuration constants

| Constant | Value | File |
| --- | --- | --- |
| `TELEGRAM_VIDEO_SIZE_LIMIT` | 20 MiB | [src/handlers/embed.ts](../src/handlers/embed.ts) |
| `KV_TTL_SECONDS` | 86 400 | [src/scraper/index.ts](../src/scraper/index.ts) |
| `DEFAULT_WIDTH`, `DEFAULT_HEIGHT` | 400, 400 | [src/handlers/embed.ts](../src/handlers/embed.ts) |
| `IG_APP_ID` | `936619743392459` | [src/scraper/oembed.ts](../src/scraper/oembed.ts) |
| `CANVAS_WIDTH_FACTOR`, `TARGET_ROW_HEIGHT`, `MAX_ROW_IMAGES` | 1.5, 1000, 3 | [src/grid/layout.ts](../src/grid/layout.ts) |
| `BR_DAILY_CAP` | 300 (wrangler.toml `[vars]`) | [src/scraper/br-cap.ts](../src/scraper/br-cap.ts) |
| `LOG_LEVEL` | `error` \| `warn` \| `info`; default `info` (wrangler.toml `[vars]`) | [src/utils/log.ts](../src/utils/log.ts) — runtime gate for structured JSON logs; see [docs/OBSERVABILITY.md](OBSERVABILITY.md) |

## Known limitations

- **Reel videos > 20 MB** downgrade to thumbnail-only cards; Telegram won't inline-play regardless of what we emit.
- **Carousels containing videos** emit the first item's URL shape; mixed-media carousels aren't composited specially.
- **Private / deleted / region-locked posts** fall through to a 302 redirect to Instagram (which itself usually returns 404).
- **`/share/reel/:postID`** is untested against real URLs; logic is straight HEAD + `Location`-unwrap.
