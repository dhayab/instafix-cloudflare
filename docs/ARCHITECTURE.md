# Architecture

InstaFix is a Cloudflare Worker that turns Instagram URLs into chat-app-ready OpenGraph / Twitter-Card HTML. Users rewrite `instagram.com/...` to `<worker-domain>/...` and post the rewritten link in Discord, Telegram, iMessage, etc.; the scraper returns a response the chat app's unfurler can actually render.

## Worker topology

```
┌───────────────────────────────────────────────────────────────┐
│  Cloudflare Worker (name: instafix)                           │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  Hono router (src/index.ts)                             │  │
│  │  Trailing-slash rewrite middleware, route table         │  │
│  └────────────────────────┬────────────────────────────────┘  │
│                           │                                   │
│  ┌────────────────────────▼────────────────────────────────┐  │
│  │  Handlers (src/handlers/)                               │  │
│  │  embed · images · videos · grid · thumbnails            │  │
│  │  oembed · home · favicon                                │  │
│  └────┬──────────────────┬────────────────────┬────────────┘  │
│       │                  │                    │               │
│       ▼                  ▼                    ▼               │
│  ┌─────────────┐   ┌─────────────┐      ┌──────────────┐      │
│  │ Scraper     │   │ Grid /      │      │ Views        │      │
│  │ src/scraper │   │ overlay     │      │ src/views    │      │
│  │ oembed + BR │   │ src/grid    │      │ OG/Twitter   │      │
│  │ merge       │   │ Photon WASM │      │ meta tags    │      │
│  └──┬───────┬──┘   └──────┬──────┘      └──────────────┘      │
│     │       │             │                                   │
└─────┼───────┼─────────────┼───────────────────────────────────┘
      │       │             │
      ▼       ▼             ▼
┌─────────┐ ┌────┐      ┌──────────┐
│ KV      │ │ BR │      │ R2       │
│instafix-│ │API │      │instafix- │
│post-    │ │    │      │grids     │
│cache    │ │    │      │          │
└─────────┘ └────┘      └──────────┘
              │
              ▼
    ┌─────────────────────┐       ┌─────────────────────────────┐
    │ api.instagram.com   │       │ scontent.cdninstagram.com   │
    │ /api/v1/oembed      │       │ (image / video bytes)       │
    └─────────────────────┘       └─────────────────────────────┘
```

- The **router** is a thin wrapper. Only one piece of real middleware: a trailing-slash rewrite that re-dispatches internally instead of issuing a 301 (chat scrapers tend to drop previews on 3xx).
- **Handlers** are each one file, each responsible for one URL shape. They call into scraper/grid and then return either an embed HTML (via views) or a 302 / JPEG.
- The **scraper** is the only place that talks to Instagram or Cloudflare Browser Rendering. All caller paths go through `getData(postID, kind, env, ctx)` and get back an `InstaData` or `null`.
- **Grid / overlay** are pure pixel work via `@cf-wasm/photon`. They read source media URLs from `InstaData` and produce a JPEG cached in R2.
- **Views** is a single template function rendering the OG/Twitter meta-tag HTML from a `ViewsData` struct.

## Request flow — single-image post (`/p/:id`)

1. Router receives GET; trailing-slash middleware rewrites `/p/abc/` → `/p/abc` if needed.
2. Embed handler extracts `postID`, `mediaNum`, query/header switches (`direct`, `gallery`, `img_index`).
3. `isBot()` checks the User-Agent. Non-bot → 302 to real Instagram (humans shouldn't land on our preview).
4. `getData(id, 'p', env, ctx)` checks KV `instafix-posts-cache:post:v4:p:{id}`. On hit, returns cached `InstaData`.
5. On miss, runs `scrapeFromOEmbed` and `scrapeViaBrowser` in parallel. `Promise.all` resolves with both. Merge rules: BR wins for `Medias[]` and per-item dimensions; oembed wins for `Caption`, `Username`, and `Thumbnail`.
6. KV write is fire-and-forget via `ctx.waitUntil`.
7. Embed handler picks `Card = 'summary_large_image'`, `ImageURL = /images/{id}/1`, builds the OG meta-tag HTML, returns it.

Cold miss ≈ 200 ms–2.8 s depending on whether BR is reachable; warm hit ≈ 6 ms.

## Request flow — reel (video post)

Identical to the above through step 6, but with one extra: after extracting the `video_versions` array from BR's rendered HTML, the scraper issues a HEAD to the best video URL and stores `ContentLength` on the `Media`.

The embed handler then branches:

- **ContentLength ≤ 20 MB** → `Card = 'player'`, `VideoURL = /videos/{id}/1`, `ImageURL = /thumbnails/{id}` (poster for the preview card), plus `OEmbedURL` for the video-player protocol.
- **ContentLength > 20 MB** → Telegram silently drops inline-video previews at this threshold, so we downgrade to `Card = 'summary_large_image'`, `ImageURL = /thumbnails/{id}`, no `og:video`. The thumbnail gets a play-icon overlay so the user still sees "this is a video".

## Request flow — carousel grid (`/grid/:id`)

Triggered by the embed handler setting `ImageURL = /grid/{id}` when `Medias.length > 1` on a `/p/{id}` post. When the chat scraper then follows that URL:

1. R2 lookup at `grids/{id}.jpg`. On hit, return the blob with `Cache-Control: public, max-age=86400, immutable`.
2. On miss, load `InstaData` (KV-hit or scrape), filter `Medias` to images with known width/height.
3. If 0 images, 404; if 1 image, 302 to `/images/{id}/1`.
4. Otherwise, `composeGrid()`:
   - Parallel fetch all source JPEGs
   - `planGrid()` runs the row-break layout algorithm (ported from the Go original's Dijkstra, but reduced to a forward sweep since the DAG has out-degree ≤ 3)
   - For each row: decode each source with Photon, resize to the target tile size with Lanczos, `watermark` onto the canvas at `(x, y)`, free transient images immediately
   - `get_bytes_jpeg(80)` → final JPEG
5. Write back to R2 via `ctx.waitUntil`.

Cold miss for a 6-image carousel ≈ 4.6 s; R2 hit ≈ 4 ms.

## Scraper tiers

Instagram no longer server-renders post data to logged-out crawlers, so all "tier 1/2/3" paths from the original Go codebase (`embed/captioned/` TimeSlice parse, goquery selectors, raw GraphQL) return either an empty shell or a 403. Two live sources replace them:

| Source | Latency | Gives us | Used for |
| --- | --- | --- | --- |
| `api.instagram.com/api/v1/oembed` with `X-Ig-App-Id: 936619743392459` | ≈ 200 ms | caption, author, poster thumbnail | Every request — cheap, reliable |
| Cloudflare Browser Rendering `/content` | ≈ 2.5 s | full rendered HTML → parsed `carousel_media[]` / `video_versions[]` | Carousel media list, actual video URLs, per-item dimensions |

Both run in parallel on cache miss. Their results merge in [src/scraper/index.ts](../src/scraper/index.ts); if BR is unavailable (missing credentials, quota hit) the single-image path still works via oembed alone, but reels and carousels degrade gracefully — `Medias` contains the poster frame, video URLs are absent.

## Storage & bindings

| Binding | Resource kind | Resource name | Key format | Lifetime |
| --- | --- | --- | --- | --- |
| `env.POSTS_CACHE` | KV namespace | `instafix-posts-cache` | `post:v4:{kind}:{postID}` | TTL 86 400 s |
| `env.GRIDS` | R2 bucket | `instafix-grids` | `grids/{id}.jpg`, `thumbnails/{id}-play.jpg` | lifecycle 30 d |
| `env.IMAGES` | Cloudflare Images | _(reserved; unused)_ | — | — |
| `env.CF_ACCOUNT_ID` / `env.CF_BROWSER_API_TOKEN` | Plain/secret env vars | — | — | — |

Convention: every shared-namespace resource (KV namespaces and R2 buckets are account-scoped) is prefixed `instafix-`. The Worker-local binding name stays short (`POSTS_CACHE`, `GRIDS`) because it's only referenced inside the Worker.

**KV key versioning** is load-bearing. Any time the `InstaData` or `Media` shape changes, the key prefix (`post:v4:…`) must be bumped — old entries don't carry the new fields and would otherwise silently produce broken embeds until they expire 24 h later. Bumping the version key-misses them immediately and forces a re-scrape.

**Stampede protection** is a small in-isolate `Map<key, Promise>` in the scraper, grid, and thumbnail handlers. It only dedupes within one isolate; across isolates, KV/R2 is the shared layer.

## Grid layout algorithm

`src/grid/layout.ts` ports the row-break algorithm from the Go original (derived from [Vjeux's Google Plus photo-layout post](https://blog.vjeux.com/2014/image/google-plus-layout-find-best-breaks.html)). Given N images with known dimensions:

- `canvasWidth = round(1.5 × mean(source widths))`
- For a slice of images stretched to fill `canvasWidth` while preserving aspect ratios, `rowHeight = canvasWidth / Σ(w/h)`
- Row cost = `(1000 − rowHeight)²` — penalises rows whose natural height drifts from ~1000 px, which empirically produces pleasant grids
- Rows are capped at 3 images each
- The DAG has nodes `0..N` (one per "cut position") and edges `i → j` with `j ≤ i + 3`; min-cost path from `0` to `N` yields the row breaks. Out-degree ≤ 3 lets a single forward sweep replace Dijkstra.

## Play-icon overlay

`src/grid/play-icon.ts` draws the overlay in pure pixel math, no asset dependency. Translucent dark circle (α 0.62) with a one-pixel antialiased edge, plus an opaque white equilateral triangle pointing right, shifted left by 20 % of its radius so its optical centroid aligns with the circle's geometric centroid. Scales with the source image — icon diameter is 32 % of `min(width, height)`.

Applied on cache miss in [src/handlers/thumbnails.ts](../src/handlers/thumbnails.ts): decode poster JPEG → mutate pixel buffer in-place → re-encode JPEG at quality 82 → cache in R2.

## Key design decisions

- **Always-BR on `/p/` and `/reel/`**. Oembed alone can't signal "this is a carousel" or give us a real video URL; KV absorbs the cost so even viral posts cost one BR call per day.
- **Internal trailing-slash rewrite** instead of Hono's `trimTrailingSlash()`. Hono's emits 301; many chat scrapers (Twitter, some Telegram paths) drop previews on 3xx. See [src/index.ts](../src/index.ts).
- **Worker-proxied thumbnails, not direct CDN URLs**. Instagram CDN URLs are time-signed and expire ~6 h out; a Telegram-cached preview pointing at a signed URL would 403 after a few hours. Our `/thumbnails/:id` URL is stable and redirects (or re-composites) to whatever the fresh CDN URL is.
- **Size-based card downgrade**. Telegram silently drops `og:video` previews above ~20 MB. HEAD the video URL during scrape, cache `ContentLength`, emit a thumbnail card for long reels.
- **Drop the remote-scraper integration** from the Go original. The binary-over-zstd-dict protocol didn't translate cleanly to Workers, and Cloudflare Browser Rendering gives us the same (or better) signal with less engineering.

## Performance (local dev)

| Endpoint                        | Cold miss             | Warm        |
| ------------------------------- | --------------------- | ----------- |
| `/p/:id` — single image         | ≈ 2.8 s               | ≈ 6 ms (KV) |
| `/reel/:id`                     | ≈ 2.9 s               | ≈ 6 ms (KV) |
| `/videos/:id/1`                 | shares the post cache | ≈ 4 ms      |
| `/grid/:id` — 6-image composite | ≈ 4.6 s               | ≈ 4 ms (R2) |
| `/thumbnails/:id`               | ≈ 0.5 s               | ≈ 4 ms (R2) |

## Dependencies

### Runtime

| Package           | Purpose                                                  |
| ----------------- | -------------------------------------------------------- |
| `hono`            | Router + middleware                                      |
| `@cf-wasm/photon` | JPEG decode / resize / composite / encode (~500 KB WASM) |

### Dev only (not bundled)

| Package | Purpose |
| --- | --- |
| `wrangler` | Dev server, types generator, deploy |
| `typescript` | Type checking |
| `oxlint` | Linter (Rust-based) |
| `oxfmt` | Formatter (Rust-based) |
| `@cloudflare/workers-types` | Binding and runtime type declarations |
| `vitest` + `@cloudflare/vitest-pool-workers` | Test runtime (no suite yet) |
