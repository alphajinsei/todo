# todo

公開の todo と、毎週やったことの記録（人生の週のマスに積み上がる）。何を作るかは [docs/design.md](docs/design.md)。

- 公開先：https://todo.alphajinsei.com（閲覧は誰でも、編集は `/admin` から本人だけ）
- 方式②（標準・アプリ + DB）。[sample-cf-workers-d1](https://github.com/alphajinsei/sample-cf-workers-d1) から作った
- 全体の方針と、どの方式でも共通の決まりごと：[サービス開発ガイド](https://github.com/alphajinsei/cf-infra-playbook/blob/main/docs/service-guide.md)（手元では `~/claude-sandbox/infra/docs/service-guide.md`）
- Cloudflare の上で作るときに知っておくこと：[基盤ガイド：Cloudflare](https://github.com/alphajinsei/cf-infra-playbook/blob/main/docs/platforms/cloudflare.md)

## 1. この方式の用途

利用者は本人1人、データは小さく、閲覧は公開・編集は本人だけ。方式②がそのまま当てはまる（Access で `/admin` を本人に限る形も、サンプルと同じ）。

## 2. 構成と主なファイル

```
 Browser --> edge --+-- /admin/*  --> Access (login) --+
                    |                                  |
                    +-- file in public/? --> return it  |
                    |                                  v
                    +-- otherwise ---------------> Worker (src/index.ts, Hono)
                                                       |  verify Access JWT on /admin/api/*
                                                       |  binding "DB"
                                                       v
                                                     D1: todo-db
```

| パス | 誰が | 中身 |
| --- | --- | --- |
| `/` | 誰でも | 画面（閲覧モード） |
| `GET /api/data` | 誰でも | 全体（`owner`・`tasks`・`records`） |
| `/admin` | 本人（Access） | 同じ画面を編集モードで |
| `/admin/api/...` | 本人（Access + JWT の検証） | 書き込み（下の表） |

| 書き込みの API | 中身 |
| --- | --- |
| `POST /admin/api/tasks` | タスクを追加（`title`、任意で `memo`・`deadline`） |
| `POST /admin/api/tasks/order` | 並べ替え（`ids`：上から順の id の配列）。新しいタスクは一番上に入る |
| `PATCH /admin/api/tasks/:id` | 送った項目だけ変える（`title`・`memo`・`deadline`。期限は空にすると期限なし） |
| `DELETE /admin/api/tasks/:id` | 削除（記録は残る） |
| `POST .../tasks/:id/done` | 完了。その日の記録に自動で1行入る |
| `POST .../tasks/:id/reopen` | 完了の取り消し。自動で入った記録も消す |
| `POST /admin/api/records` | 記録を追加（`text`・`date`、任意で `taskId`）。未来の日付は不可 |
| `PATCH .../records/:id`・`DELETE .../records/:id` | 記録の編集・削除 |

書き込みはどれも全体（`GET /api/data` と同じ形）を返し、画面はそれで描き直す。

| ファイル | 役割 |
| --- | --- |
| `wrangler.jsonc` | Worker の定義。D1、静的ファイル（`ASSETS` binding つき）、`vars`（誕生日、寿命、タイムゾーン）、Access の検証に使う値 |
| `src/index.ts` | API 本体（Hono） |
| `src/rules.ts` | 入力の検証と「今日」（`TIME_ZONE` で決める） |
| `src/access.ts` | `/admin/api/*` の前で Access の JWT を検証する。`ACCESS_AUD` が空なら書き込みはすべて 403 |
| `src/db/schema.ts` | テーブル定義の唯一の正（`tasks`・`records`） |
| `migrations/` | drizzle-kit が作ったマイグレーション。手で書かない |
| `public/` | 画面（素の HTML / CSS / JS、ビルドなし）。URL が `/admin` なら編集モード |
| `seed/`、`scripts/seed.mjs` | 手元の D1 に流す見本のデータ（旧形式の JSON）と、それを SQL にするスクリプト |
| `infra/terraform/` | Access。`tf.sh` が `~/claude-sandbox/infra/.secrets/` の鍵を読んで terraform を実行する。state は R2 の `tfstate` バケットの `todo/terraform.tfstate` |

## 3. 手元での開発

```bash
npm install
cp .dev.vars.example .dev.vars                # 手元では Access の検証を飛ばす（DEV_SKIP_ACCESS）
npx wrangler d1 migrations apply DB --local   # 手元の D1 にテーブルを作る
npm run seed:sample                           # 見本のデータを入れる（既存の行は消える）
npm run dev                                   # http://localhost:8787/ と http://localhost:8787/admin
```

- `seed:sample` は `seed/sample.json`（期限切れ・過去の週の記録などの見え方の確認用）を、`asOf` の日が今日になるようずらして入れる。`seed:tasks` は `seed/tasks.json`（最初期の形式）をメモにまとめて入れる。
- 型の確認：`npm run check`。`wrangler.jsonc` を変えたら `npx wrangler types`。
- テーブルを変える手順はサンプルと同じ（`schema.ts` → `npx drizzle-kit generate` → `--local` で確かめる → `npm run deploy`）。

## 4. ビルドとデプロイ

```bash
npm run deploy    # = wrangler d1 migrations apply DB --remote && wrangler deploy
```

Access（Terraform）は別の操作：

```bash
cd infra/terraform
cp owner.auto.tfvars.example owner.auto.tfvars   # 初回だけ。自分のメールアドレスを書く
./tf.sh init      # 初回だけ
./tf.sh apply     # 効くまで数分かかる
./tf.sh output access_aud
```

### 初回だけの作業（順番が大事）

1. `npx wrangler d1 create todo-db --location apac` → 出力の `database_id` を `wrangler.jsonc` に書く
2. `infra/terraform` で `./tf.sh apply` → `./tf.sh output access_aud` の値を `wrangler.jsonc` の `vars.ACCESS_AUD` に書く
3. `npm run deploy`
4. 確かめる：`/` と `/api/data` はログインなしで 200、`/admin` は `cloudflareaccess.com` へ 302、ログイン後に `/admin` から追加できる

`ACCESS_AUD` が空のままデプロイしても、閲覧はできて書き込みは 403 になるだけ（安全側）。

## 5. このサンプルから新しいサービスを始める

これはサンプルではなくサービスなので、テンプレートには使わない。新しいサービスは [sample-cf-workers-d1](https://github.com/alphajinsei/sample-cf-workers-d1) から始める。サンプルから変えたところ：

- 書き込みを `/admin/api/*` に置き、Access の守る範囲（`/admin`）1つで画面と API を両方守る
- Worker でも Access の JWT を検証する（`src/access.ts`、依存に `jose`）
- 編集画面 `/admin` は、`ASSETS` binding で `public/index.html` を返す
- Access の許可するメールアドレスを、git 管理外の `owner.auto.tfvars` に分けた

## 6. この方式の注意点

サンプルの注意点（状態は D1 に、スキーマは `schema.ts` から、`batch` がトランザクション、rollback はコードだけ、など）はそのまま当てはまる。このサービスに固有のもの：

- **公開される。**`/api/data` は誰でも読める。タスク、メモ、週の記録、誕生日（`vars`）はすべて公開される前提で書く。
- **「今日」はサーバーが決める。**Worker は UTC で動くので、`TIME_ZONE`（Asia/Tokyo）で日付を区切る。画面の残り時間の表示はブラウザの時計。
- **`.dev.vars` を本番に持ち込まない。**`DEV_SKIP_ACCESS` は手元の `wrangler dev` だけで読まれる。`wrangler secret` や `vars` に入れると、誰でも書き込めるようになる。
- **`compatibility_date` は手元の workerd より新しくできない。**新しくすると `wrangler dev` が起動しない。
