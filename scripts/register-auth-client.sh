#!/usr/bin/env bash
# auth（auth.alphajinsei.com）に、Cloudflare Access を client として登録する（auth のステップ9-d）。
# infra/terraform を apply したあとに1回。client_secret を作り直したとき（random_password を作り直したとき）も、もう一度流す。
# client_secret は Terraform の出力から読み、ssh の標準入力で auth の管理用コマンドに渡す。画面にも、手元のファイルにも、コマンドの引数（ps で見える）にも出さない。
# 何度流してもよい（登録済みなら、secret と redirect_uri を合わせ直す）
set -euo pipefail
cd "$(dirname "$0")/../infra/terraform"

CLIENT_ID=cloudflare-access
# Access が auth から戻ってくる先。チーム名（alphajinsei）は ACCESS_TEAM_DOMAIN と同じ
REDIRECT_URI=https://alphajinsei.cloudflareaccess.com/cdn-cgi/access/callback

./tf.sh output -raw auth_client_secret \
  | ssh oci-app "cd /opt/apps/auth && docker compose exec -T app node dist/admin.js create-client --secret-stdin $CLIENT_ID $REDIRECT_URI 'Cloudflare Access'"
