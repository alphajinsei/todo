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

### Q. JWT は比較的長いテキストだと思っていたが、HTTP のヘッダーに収まるのか。そもそもヘッダーのサイズに上限はあるのか

収まる。Access の JWT は 1KB 前後で、ヘッダーとしてはよくある大きさ。

HTTP の仕様そのものにはヘッダーの上限はない。上限は、それぞれのサーバーや中継が自分で決めている。

| どこ | 上限の目安 |
| --- | --- |
| Cloudflare（入口） | リクエストヘッダー全体で 128KB |
| nginx（既定） | 1行 8KB（`large_client_header_buffers 4 8k`） |
| Node.js（既定） | ヘッダー全体で 16KB |
| ブラウザの Cookie | 1つあたり約 4KB |

なので、数 KB を超えるような JWT（中にたくさんの情報を詰めたもの）だと、どこかで 431（Request Header Fields Too Large）などで弾かれることがある。JWT に何でも詰めないほうがよい理由の1つ。

実物の例：未ログインで `/admin` を開いたときの 302 の転送先 URL に、`meta=eyJ0eXAiOiJKV1Qi...` という JWT が入っていた（約 1.3KB）。`eyJ` は `{"` を Base64URL にしたもので、JWT の目印。

### Q. JWT は名前からしてアクセストークンを入れるものだと思っていたが、「メール認証を通った」という証明にも使えるのか。JWT は JSON をやり取りするためのフォーマットの取り決めにすぎず、中身は何でもいいのか。HTTP のようなプロトコルに近い概念なのか

中身は何でもいい、という理解で合っている。JWT（RFC 7519）は「JSON の主張（claims）を、署名つきで、URL やヘッダーに載せられる文字列にする」ための**形式**の取り決めで、何を主張するかは決めていない。

1点だけ訂正すると、HTTP のような**プロトコル**（どういう手順でやり取りするか）とは種類が違う。JWT が決めるのは「1つの品物の形」だけで、誰が誰にいつ渡すかは決めない。たとえるなら、封筒と封蝋の規格。

- **形**：`ヘッダー.中身.署名` の3つを `.` でつなぎ、それぞれ Base64URL にする。ヘッダーに署名の方式（`alg`、Access は RS256）を書く。署名の部分は JWS（RFC 7515）という別の規格。暗号化する版（JWE）もある。
- **中身**：よく使う項目の名前（`iss`、`sub`、`aud`、`exp`、`nbf`、`iat`、`jti`）は決めてあるが、どれも必須ではない。それ以外の項目も自由に足せる。
- **意味**：その JWT を使う側の**プロトコル**が決める。たとえば OIDC は「ID トークンは JWT で、`iss`・`sub`・`aud`・`exp`・`iat` を必ず入れる」と決めている。

なので、同じ JWT という形で、まったく違う意味のものが流れている。

| 使われ方 | 何を表すか | 決めている規格 |
| --- | --- | --- |
| OIDC の ID トークン | 「この人がログインした」という IdP の証明 | OpenID Connect Core |
| Access の JWT（今回） | 「この人がこの Access アプリのポリシーを通った」という Cloudflare の証明。ID トークンにかなり近い | Cloudflare 独自 |
| アクセストークン | 「この API をこの範囲で呼んでよい」という許可 | OAuth 2.0（JWT にする場合は RFC 9068） |
| Access の `meta`（302 の URL の中） | ログイン画面に渡す、戻り先などの情報 | Cloudflare 独自 |

逆に、アクセストークンは JWT でなくてもよい。ランダムな文字列を渡して、サーバー側の DB で引く方式（opaque なトークン）もよく使われる。「トークン」は「持っている人に権限がある品物」という**使われ方**の名前で、JWT は**形**の名前、と分けて考えると混ざらない。

（あとからの理解）「JWT を送る」と書かれていると、JWT という言葉に何か意味が含まれているように見えるが、言っているのは「署名付きの JSON を送る」ということだけ。中に何が入っていて何を意味するかは、送ってくる側（今回なら Cloudflare）が決めている。プロトコルというより「規格」と呼ぶほうがしっくりくる。
