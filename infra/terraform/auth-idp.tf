# ---- Access のログインの選択肢に「auth でログイン」を足す（auth のステップ9） ----
# Access が OIDC の RP、auth（auth.alphajinsei.com）が OP になる。流れは auth の docs/steps/9-cloudflare-access.md
# IdP の設定は Cloudflare のアカウントに1つで、todo 以外の Access のアプリからも選べる（allowed_idps を絞らないアプリでは、ログイン画面に出る）
# ワンタイムコード（アカウントに最初からある IdP）は残す。auth が落ちても todo を編集できるように

locals {
  auth_issuer    = "https://auth.alphajinsei.com"
  auth_client_id = "cloudflare-access" # auth に登録する client_id（auth の設計の「登録している client」の台帳）
}

# client_secret：ここで作り、Access の IdP の設定に入れる。auth へは scripts/register-auth-client.sh で流し込む（画面にもファイルにも出さない）
# 値は state（R2、非公開）に残る。Access の設定にも同じ値が入るので、置き場所が増えるわけではない
resource "random_password" "auth_client_secret" {
  length  = 48
  special = false # Basic ヘッダーでも本文でも、エンコードの差で食い違わないように英数字だけ
}

resource "cloudflare_zero_trust_access_identity_provider" "auth" {
  account_id = local.account_id
  name       = "auth.alphajinsei.com" # Access のログイン画面のボタンに出る名前
  type       = "oidc"
  config = {
    client_id     = local.auth_client_id
    client_secret = random_password.auth_client_secret.result
    # Access は Discovery を読まないので、auth の Discovery（/.well-known/openid-configuration）の値を写す
    auth_url  = "${local.auth_issuer}/authorize"
    token_url = "${local.auth_issuer}/token"
    certs_url = "${local.auth_issuer}/jwks.json" # ID トークンの署名（ES256）を確かめる公開鍵
    # auth は PKCE（S256）を必須にしている
    pkce_enabled = true
    # email：ID トークンに email を入れてもらい、ポリシー（owner_emails）と照らす。auth は email scope のときだけ email を出す
    scopes           = ["openid", "email", "profile"]
    email_claim_name = "email"
    # ID トークンの中から、email と amr のほかに取っておくクレーム。Access の利用者の情報の oidc_fields に入り、
    # 管理画面の Test で見える。ポリシーの条件（OIDC Claim）にも使える。学習のために、auth が出す利用者の項目を並べた
    claims = ["sub", "preferred_username", "email_verified", "auth_time"]
  }
}

# auth に client を登録するときに、register-auth-client.sh が読む。画面には出さない
output "auth_client_secret" {
  value     = random_password.auth_client_secret.result
  sensitive = true
}

# Access が auth から戻ってくる先（Cloudflare が決める）。register-auth-client.sh の REDIRECT_URI と同じであることを確かめる
output "auth_idp_redirect_url" {
  value = cloudflare_zero_trust_access_identity_provider.auth.config.redirect_url
}
