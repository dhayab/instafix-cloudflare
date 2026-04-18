# KV namespace: post metadata cache, 24h TTL enforced in application code.
resource "cloudflare_workers_kv_namespace" "posts_cache" {
  account_id = var.cloudflare_account_id
  title      = "instafix-posts-cache"
}

# R2 bucket: generated grid JPEGs and play-overlay thumbnails.
resource "cloudflare_r2_bucket" "grids" {
  account_id = var.cloudflare_account_id
  name       = "instafix-grids"
}

# Expire grid/thumbnail objects after 30 days. Empty `prefix` matches the
# whole bucket. The Worker regenerates anything missed on a cache miss.
resource "cloudflare_r2_bucket_lifecycle" "grids" {
  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.grids.name

  rules = [{
    id      = "expire-grids-after-30d"
    enabled = true
    conditions = {
      prefix = ""
    }
    delete_objects_transition = {
      condition = {
        type    = "Age"
        max_age = 30 * 86400
      }
    }
  }]
}

# Custom domain binding is deliberately not managed here yet — bind via the
# dashboard, or add `cloudflare_workers_custom_domain` when ready (requires the
# zone to be on the same Cloudflare account).
