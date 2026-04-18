# Outputs are consumed by scripts/deploy.sh, which exports each one as an
# UPPER_SNAKE_CASE environment variable and hands off to `wrangler deploy`.
# wrangler.toml references them via `${POSTS_CACHE_KV_ID}` etc.

output "posts_cache_kv_id" {
  description = "KV namespace id; goes into wrangler.toml's POSTS_CACHE binding."
  value       = cloudflare_workers_kv_namespace.posts_cache.id
}

output "grids_bucket_name" {
  description = "R2 bucket name; currently hardcoded in wrangler.toml, exported for completeness."
  value       = cloudflare_r2_bucket.grids.name
}
