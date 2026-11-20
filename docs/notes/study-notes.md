# 勉強メモ：todo

最終更新：2026-11-20

todo を作り、公開する中で出てきた疑問と、その答えを積み上げていくメモ。1つの問いに1つの見出しを立てる。答えは、会話の中で説明した内容を、圧縮せずにそのまま残す。Cloudflare や基盤そのものの話は infra リポジトリの [勉強メモ](https://github.com/alphajinsei/cf-infra-playbook/blob/main/docs/notes/study-notes.md)、認証・認可の一般論は auth リポジトリの [勉強メモ](https://github.com/alphajinsei/auth/blob/main/docs/notes/study-notes.md)。

## Cloudflare Access

### Q. `access_aud` とは何か。Access でメール認証が通ると、Cloudflare が署名付きの JWT を Cookie か何かに入れて、todo 側でそれを Cloudflare の公開鍵で検証する、ということか

その理解でほぼ合っている。JWT は「この人は、このアプリの Access のポリシーを通った」という Cloudflare の署名付きの証明で、todo の Worker はその署名を Cloudflare の公開鍵で確かめている。`access_aud` は、その JWT が **どの Access アプリ向けに出されたか** を表す ID。

流れは次のとおり。

1. ブラウザが `todo.alphajinsei.com/admin` を開く。Access が前に立っていて、ログインしていなければログイン画面（`alphajinsei.cloudflareaccess.com`）へ転送する。
2. ワンタイムコード（あとで OIDC も）で本人確認し、ポリシー（「この2つのメールアドレスのどちらか」）に合えば、Access が JWT を発行する。
3. JWT は Cookie（`CF_Authorization`）としてブラウザに入る。ここは想像どおり。
4. 以降のリクエストでは、Access が Cloudflare の入口でこの Cookie を確かめ、通ったものだけを Worker に渡す。そのとき、JWT を **`Cf-Access-Jwt-Assertion` ヘッダー** に入れて渡す。Worker が見ているのは Cookie ではなく、このヘッダー。
5. Worker（`src/access.ts`）は、`https://alphajinsei.cloudflareaccess.com/cdn-cgi/access/certs` から公開鍵を取り、jose の `jwtVerify` で次を確かめる。

| 確かめること | JWT の項目 | 意味 |
| --- | --- | --- |
| 署名 | （ヘッダーの `kid` で鍵を選ぶ） | 本当に Cloudflare が出したもので、書き換えられていない |
| 発行者 | `iss` | 自分のチーム（`alphajinsei.cloudflareaccess.com`）が出したもの |
| 宛先 | `aud` | **todo admin のアプリ向け** に出たもの。ここで `ACCESS_AUD` と比べる |
| 期限 | `exp` | 期限が切れていない（セッションは 720 時間） |

JWT の中には、ほかに `email`（ログインした人のアドレス）、`sub`（利用者の ID）、`iat`（発行時刻）なども入っている。

**なぜ `aud` を確かめるのか。** 同じチーム（`alphajinsei.cloudflareaccess.com`）では、hoikuen など別のアプリにも Access をかけていて、そちらの JWT も同じ鍵で署名されている。署名と `iss` だけだと、別のアプリ用の JWT でも通ってしまう。`aud` で「todo admin 用に出たものだけ」に絞る。ID トークンの `aud` を client_id と比べるのと同じ考え方。

**なぜ Access が前にいるのに、Worker でも確かめるのか。** 多層防御のため。Access の設定（守るパスの指定など）を間違えたときや、Access を通らない経路（workers.dev の URL など）から Worker に届いたときでも、書き込みを通さないようにする。ヘッダーは誰でも付けられるので、「ヘッダーがあるか」ではなく「署名が正しいか」を見る。`ACCESS_AUD` が空なら、書き込みの API はすべて 403 にしてある（閉じる側に倒す）。

なお、`aud` の値は秘密ではない。JWT を持っている人なら中身を読めるし、知っていても署名は作れない。なので `wrangler.jsonc` にそのまま書いて、公開リポジトリにコミットしている。
