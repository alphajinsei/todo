provider "cloudflare" {
  # 認証は環境変数 CLOUDFLARE_API_TOKEN から読む（tf.sh）
}

# 公開リポジトリなので、メールアドレスはファイルに書かず owner.auto.tfvars（git 管理外）で渡す
variable "owner_email" {
  type        = string
  description = "編集を許すメールアドレス（Access のログインに使う）"
}

locals {
  account_id = "da07fbd6d431eccc008a74d695734e73"
  hostname   = "todo.alphajinsei.com"
}

# 誰を通すか：自分のメールアドレスだけ
resource "cloudflare_zero_trust_access_policy" "owner_only" {
  account_id = local.account_id
  name       = "todo: owner only"
  decision   = "allow"
  include = [{
    email = { email = var.owner_email }
  }]
}

# どこを守るか：/admin 以下（編集画面 /admin と、書き込みの API /admin/api/*）
resource "cloudflare_zero_trust_access_application" "admin" {
  account_id       = local.account_id
  name             = "todo admin"
  type             = "self_hosted"
  domain           = "${local.hostname}/admin"
  session_duration = "720h" # 毎日使うので長め（30日）
  policies = [{
    id         = cloudflare_zero_trust_access_policy.owner_only.id
    precedence = 1
  }]
}

# Worker が JWT を検証するときの aud。wrangler.jsonc の vars.ACCESS_AUD に入れる
output "access_aud" {
  value = cloudflare_zero_trust_access_application.admin.aud
}
