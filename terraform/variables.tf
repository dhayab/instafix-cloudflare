variable "cloudflare_account_id" {
  description = "Cloudflare account id that owns the Worker, KV namespace, and R2 bucket."
  type        = string
}

variable "cloudflare_api_token" {
  description = "Cloudflare API token with Workers Scripts + KV + R2 Edit scopes. Distinct from the narrowly-scoped Worker runtime CF_BROWSER_API_TOKEN."
  type        = string
  sensitive   = true
}
