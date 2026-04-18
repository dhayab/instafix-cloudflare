# Token scope: Workers Scripts - Edit, Workers KV Storage - Edit,
#              Workers R2 Storage - Edit. (Add Zone: DNS - Edit later if you
#              manage custom domains via Terraform.)
#
# This is NOT the same token as CF_BROWSER_API_TOKEN (which is a Worker runtime
# secret scoped only to Browser Rendering). Keep them separate.
provider "cloudflare" {
  api_token = var.cloudflare_api_token
}
