# Observability

The Worker emits structured JSON logs via `console.*`. Cloudflare Workers Observability auto-parses them into queryable fields. No log aggregation SDK is used.

## Log shape

Every event is a single-line JSON object with at least:

| Field | Type | Notes |
| --- | --- | --- |
| `event` | string | Hierarchical name, e.g. `scraper.br` |
| `level` | `"info" \| "warn" \| "error"` | Also selects which `console.*` method emits it |
| `reqId` | string | Correlation ID (CF `cf-ray` header, or a UUID fallback) |
| `ts` | number | Emission timestamp (`Date.now()`) |

Additional fields vary per event. Failure events always carry `reason` (string) and, when the thrown value was an `Error`, `stack`.

## Levels

- `info` — normal lifecycle and success outcomes.
- `warn` — recoverable failures, fallbacks, out-of-range inputs.
- `error` — unhandled errors or compose failures that return 5xx.

The `LOG_LEVEL` env var (`error` | `warn` | `info`, default `info`) gates emission. Use it as a runtime kill switch if log volume becomes an incident.

## Correlation

A Hono middleware assigns `reqId` once per request, preferring the `cf-ray` header (unique per edge request, also visible in CF's own request log) and falling back to `crypto.randomUUID()` when absent (`wrangler dev`). Helpers outside the Hono context (`src/scraper/*`, `src/utils/share.ts`) receive `reqId` as an explicit parameter.

## Event vocabulary

### Lifecycle (`src/index.ts` middleware)

| Event | Level | Fields |
| --- | --- | --- |
| `request.start` | info | `method`, `path`, `ua`, `isBot`, `host` |
| `request.done` | info | `handler`, `status`, `outcome`, `durationMs`, plus handler-specific metadata |

`request.done.outcome` values:

- `ok` — happy path.
- `bot_redirect` — non-bot UA on an embed route; 302 to instagram.com.
- `direct_redirect` — `?direct=true` or `X-Embed-Type: direct`.
- `not_found` — 404 (missing media, missing data).
- `invalid_input` — unparseable `mediaNum`, bad postID, share/stories resolution failed. When this fires, an `invalidReason` field is set: `mediaNum` | `postID` | `share_unresolvable` | `stories_decode`.
- `out_of_range` — `mediaNum` exceeds carousel length.
- `scrape_failed` — `getData` threw or returned null; caller falls back to a redirect.
- `compose_failed` — Photon compose threw; handler returns 5xx (grid) or falls back (thumbnail).
- `unhandled_error` — the handler threw; middleware's `finally` captured it. Set as the default on middleware entry so unhandled paths still surface a meaningful terminal event.

Handler-specific `metadata` fields on `request.done`:

- `embed`: `postID`, `kind`, `mediaNum`, `card?`, `hasVideo?`, `fallback?` (`"thumbnail_card"` when a large reel is downgraded), `invalidReason?`.
- `grid`: `postID`, `imageCount?`, `source?: "r2_hit" | "composed"`, `bytes?`.
- `thumbnails`: `postID`, `source?: "r2_hit" | "composed" | "cdn_fallback"`, `bytes?`.
- `videos`, `images`: `postID`, `mediaNum`.
- `oembed`, `home`, `favicon`: `handler` only.

### Scraper (`src/scraper/*`)

| Event | Level | Fields |
| --- | --- | --- |
| `scraper.done` | info | `postID`, `kind`, `source: "cache" \| "scrape"`, `coalesced`, `mediaCount`, `hasOembed`, `hasBr`, `durationMs` |
| `scraper.oembed` | info/warn | `postID`, `outcome: "ok" \| "failed"`, `type?: "fetch" \| "http" \| "parse" \| "incomplete"`, `status?`, `durationMs`, `reason?`, `stack?` |
| `scraper.br` | info/warn | `postID`, `outcome: "ok" \| "disabled" \| "skipped_over_cap" \| "failed"`, `type?: "fetch" \| "http" \| "response_invalid" \| "anchor_missing" \| "carousel_parse" \| "video_parse" \| "no_match" \| "probe"`, `shape?: "carousel" \| "video"`, `status?`, `mediaCount?`, `capCount?`, `cap?`, `durationMs`, `reason?`, `stack?`, `terminal?` |

On cache hit, only `scraper.done` fires (with `source: "cache"`); `scraper.oembed` and `scraper.br` are absent. Their absence _is_ the signal that the request was served from KV.

`coalesced: true` means the request joined an in-flight scrape via the per-isolate singleflight Map — see [src/scraper/index.ts](../src/scraper/index.ts).

`terminal: false` on a `scraper.br` failure indicates the pipeline is continuing past it (currently only `type: "anchor_missing"`). Dashboards counting failure rates should filter `terminal != false` to avoid double-counting soft signals.

### BR daily cap ([src/scraper/br-cap.ts](../src/scraper/br-cap.ts))

| Event | Level | Fields |
| --- | --- | --- |
| `br.cap.over` | warn | `count`, `cap` |
| `br.cap.counter_failed` | warn | `type: "read" \| "write"`, `reason`, `stack?` |

### Compose ([src/handlers/grid.ts](../src/handlers/grid.ts), [src/handlers/thumbnails.ts](../src/handlers/thumbnails.ts))

| Event | Level | Fields |
| --- | --- | --- |
| `compose.failed` | error | `type: "grid" \| "thumbnail"`, `postID`, `reason`, `stack?` |

## Example flows

**Happy path, scrape (carousel):**

```
request.start   path=/p/ABC isBot=true
scraper.oembed  outcome=ok durationMs=180
scraper.br      outcome=ok shape=carousel mediaCount=5 capCount=42 cap=300 durationMs=900
scraper.done    source=scrape coalesced=false mediaCount=5 durationMs=910
request.done    handler=embed outcome=ok status=200 card=summary_large_image durationMs=935
```

**Cache hit:**

```
request.start
scraper.done    source=cache mediaCount=5
request.done    handler=embed outcome=ok status=200
```

**BR failed, oembed-only fallback:**

```
request.start
scraper.oembed  outcome=ok
scraper.br      outcome=failed type=http status=500 reason="..." stack="..."
scraper.done    source=scrape hasOembed=true hasBr=false mediaCount=1
request.done    handler=embed outcome=ok card=summary_large_image
```

**BR skipped by cap:**

```
scraper.br      outcome=skipped_over_cap capCount=300 cap=300
br.cap.over     count=300 cap=300
```

## Discipline

Three rules keep log coverage complete as the code evolves:

1. **Set `c.set('metadata', ...)` before every handler return.** The lifecycle middleware reads `metadata` after `next()` to emit `request.done`. Default is `{ outcome: 'unhandled_error' }` so a thrown handler still logs a meaningful terminal event — but any successful or failed path should refine it.
2. **Thread `reqId` into every new helper that emits logs.** No AsyncLocalStorage; explicit params. If a helper can be called outside a request context (scheduled task, etc.) accept `reqId: string` so the caller is forced to decide what to pass.
3. **On failed events, include `stack`.** The `logError(event, reqId, env, err, payload?)` helper in [src/utils/log.ts](../src/utils/log.ts) does this automatically for `error`-level events. For `warn`-level recoverable failures, use inline `try/catch` that extracts `reason` and `stack` manually (see [src/scraper/oembed.ts](../src/scraper/oembed.ts)).
