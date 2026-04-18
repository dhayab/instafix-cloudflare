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

## Deploy

Infrastructure (KV namespace, R2 bucket) is managed by Terraform; the Worker code is shipped via Wrangler. `npm run deploy` wires them together: it reads `terraform output`, exports each value as an env var, and hands off to `wrangler deploy`.

### One-time setup

```bash
npm install

# 1. Terraform — provision KV + R2
cp terraform/terraform.tfvars.example terraform/terraform.tfvars
# edit terraform/terraform.tfvars with your cloudflare_account_id and
# a cloudflare_api_token scoped to Workers Scripts + KV + R2 Edit.

cd terraform && terraform init && terraform apply && cd ..

# 2. Browser Rendering secrets (Worker runtime, not Terraform-managed)
wrangler secret put CF_ACCOUNT_ID
wrangler secret put CF_BROWSER_API_TOKEN   # scope: "Browser Rendering - Edit"
```

`CF_BROWSER_API_TOKEN` is a separate, narrowly-scoped token from `CLOUDFLARE_API_TOKEN` — the former lives as a Worker runtime secret, the latter only on your machine for Terraform. Without them the scraper silently falls back to oembed-only, which can only resolve single-image posts. See [docs/SPEC.md](docs/SPEC.md#secrets) for details.

### Subsequent deploys

```bash
npm run deploy
```

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
