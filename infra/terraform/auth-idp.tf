# Access のログインの選択肢「auth.alphajinsei.com」（IdP）は、auth のリポジトリ（infra/terraform/access-idp.tf）に移した（2026-11-20）。
# IdP は Cloudflare のアカウントに1つの、auth の窓口で、todo に属するものではないため。
#
# 下の removed は、移すときに1回だけ使う：この state の管理から外すだけで、Cloudflare の上の IdP は消さない（destroy = false）。
# apply が済んだら、このファイルごと消してよい
removed {
  from = cloudflare_zero_trust_access_identity_provider.auth
  lifecycle {
    destroy = false
  }
}

removed {
  from = random_password.auth_client_secret
  lifecycle {
    destroy = false
  }
}
