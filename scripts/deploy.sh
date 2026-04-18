#!/usr/bin/env bash
# Full deploy path: terraform outputs → templated wrangler.toml → wrangler deploy.
# Assumes `terraform apply` has been run at least once.
#
# wrangler doesn't interpolate ${VAR} in kv_namespaces[].id, so we materialize
# a concrete config alongside wrangler.toml and point `wrangler deploy -c` at
# it. The generated file lives at the repo root so relative paths in the TOML
# (notably `main = "src/index.ts"`) resolve as wrangler expects.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

eval "$(cd "$ROOT/terraform" && terraform output -json \
  | jq -r 'to_entries[] | "export \(.key | ascii_upcase)=\(.value.value | @sh)"')"

TMP="$ROOT/wrangler.deploy.toml"
trap 'rm -f "$TMP"' EXIT
sed "s/dev_local_placeholder/$POSTS_CACHE_KV_ID/" "$ROOT/wrangler.toml" > "$TMP"

cd "$ROOT"
wrangler deploy -c "$TMP" "$@"
