# Zaim Web 自動取得

Issue #145 の自動取得は、Zaim APIではなくPlaywrightでZaim Webの残高画面を巡回して取得する。

## 方針

- ZaimのID・パスワードはAsset Managerに保存しない
- 初回だけブラウザで手動ログインし、Playwrightのstorage stateを保存する
- 取得は画面の「Zaimから取得」ボタンを押したとき、および1日1回の定期実行で行い、storage stateを再利用してヘッドレスChromiumから残高画面を開く
- 定期実行は確認する人がいないため、手動入力を上書きしない・異常値は保存しないという安全策を必ず通す
- セッションが切れないよう、維持専用の軽量ジョブも定期実行する
- 銀行・電子マネー等は残高画面から、証券は各証券詳細ページから証券口座ごと・個別銘柄ごとに取得する
- CAPTCHA、追加認証、セッション切れが発生した場合は自動回避せず、手動ログインをやり直す
- 取得した名称は既存の `Category.valuationAlias` と一致したものだけ評価額へ反映する
- 日付付き評価額の保存には既存の `upsertValuationChange` を利用する

## 1. Playwrightの準備

PlaywrightはNext.js本体のnpm依存には含めず、ブラウザを動かす端末/VPSへ別途インストールする。

```bash
npm install -g playwright
playwright install chromium
```

LinuxでChromiumのOS依存パッケージが不足する場合は、環境に応じてPlaywright公式の依存パッケージも導入する。

## 2. 初回ログイン

`.env.local` 等に以下を設定する。

```env
ZAIM_LOGIN_URL=https://zaim.net/
ZAIM_STORAGE_STATE_PATH=.zaim/storage-state.json
```

GUIを利用できるPCで次を実行する。

```bash
node scripts/zaim-login.mjs
```

開いたブラウザでZaimへログインする。ログイン完了は自動で検知され、storage stateが保存されてブラウザが閉じる。Cookie名に依存せず、実際に残高画面を開けるかどうかで判定している。保存後に、同期間隔の判断に使うセッションCookieの残り有効期間を表示する。

`.zaim/` には認証済みCookie等が含まれるため、Gitにはコミットしない。本番VPSで利用する場合はstorage stateを安全な方法でVPSへ配置する。

## 3. 残高画面を設定

残高一覧を表示するURLとDOMセレクタを指定する。以下は 2026-08 時点の zaim.net で実際に動作を確認した値。

```env
ZAIM_BALANCE_URL=https://zaim.net/home
ZAIM_BALANCE_ROW_SELECTOR="section.box.home-balance div.col-xs-7.text.account-name"
ZAIM_BALANCE_NAME_SELECTOR=.name
ZAIM_BALANCE_AMOUNT_SELECTOR=.value
```

行・名称・金額の3つすべてを指定すると、各行から名称と金額を直接抽出する。未指定の場合は、表示中DOMから「名称 + ¥金額」に見える小さなブロックを候補として抽出する。

注意点。

- 値に空白を含む場合はダブルクォートで囲む。
- 残高が未取得の口座は金額欄が `-`（`div.value.zero`）になる。金額として読めないため同期対象から自動的に外れる。
- ポイント口座は別クラス（`div.col-xs-7.text.point-name`）で、金額も `28,062 pt ¥12,345 相当` という形式のため、上記セレクタでは取得しない。取り込む場合は行セレクタの追加に加えて、この形式から円換算額を取り出す処理も必要になる。
- 口座名が長いと `住信 SBI ネット銀行 投...` のようにDOM上で省略される。省略前の名称はDOMに存在しないため、`valuationAlias` には省略された表示どおりの文字列を設定する。

## 4. 証券詳細ページを設定

証券は残高画面に口座の合計しか表示されないため、残高画面から証券詳細ページへのリンクを辿り、個別銘柄の評価額を取得する。

```env
ZAIM_SECURITIES_LINK_SELECTOR=
ZAIM_SECURITIES_ACCOUNT_NAME_SELECTOR=h2
ZAIM_SECURITIES_HOLDING_TABLE_SELECTOR=table
ZAIM_SECURITIES_HOLDING_NAME_HEADERS=銘柄,ファンド名
ZAIM_SECURITIES_HOLDING_AMOUNT_HEADERS=評価額
```

- `ZAIM_SECURITIES_LINK_SELECTOR` の未指定時は `a[href*="/securities/"]` を使用する。リンクは重複を除いた順に1ページずつ巡回する。
- 証券口座名は `ZAIM_SECURITIES_ACCOUNT_NAME_SELECTOR` で詳細ページから取る。zaim.net では `h2` に口座名が入る。未指定時はリンクのテキストから金額部分を除いたものを使い、それも取れなければページタイトル、最後にURLを使う。
- 銘柄は表から取得する。zaim.net の証券詳細ページには列構成の異なる表が混在するため（`銘柄・保有株数・取得単価・現在値・評価額・評価損益` の6列と、`銘柄・評価額` の2列）、列位置は決め打ちにできない。ヘッダー行の見出しを見て、`ZAIM_SECURITIES_HOLDING_AMOUNT_HEADERS` に一致する列を評価額として使う。銘柄名の列は `ZAIM_SECURITIES_HOLDING_NAME_HEADERS` で決め、見つからない場合は先頭列を使う。
- 表以外のDOMになった場合は `ZAIM_SECURITIES_HOLDING_ROW_SELECTOR` / `_NAME_SELECTOR` / `_AMOUNT_SELECTOR` の3つを指定して上書きできる。どちらの方法でも取れない場合は汎用抽出へフォールバックする。
- 同じ銘柄が特定口座・NISA等で複数行に分かれることがあるため、同一口座内の同名銘柄は合算する（`口座名/銘柄名` が一意になる）。
- 巡回するページ数が増えるほど時間がかかるため、同期処理側のタイムアウトは5分としている。

## 5. Asset Managerとの対応付け

評価額入力画面の表示設定にある `valuationAlias` に、Zaim画面上の名称を設定する。同期処理は次の優先順位で対応付ける。

| 優先 | `valuationAlias` に書く値 | 対象 |
| --- | --- | --- |
| 1 | `口座名/銘柄名#N` | 表示順のN行目を明示的に指定する（通常は不要。下記の自動割り当てを使う） |
| 2 | `口座名/銘柄名` | 同じ銘柄を証券口座ごとに別カテゴリで管理する場合（その口座の同名行の合計） |
| 3 | `銘柄名` | 同じ銘柄を口座をまたいで1カテゴリにまとめる場合（複数口座分を合算する） |
| 4 | 残高一覧の名称 | 銀行・電子マネー等。銘柄を反映していない証券口座の合計もここで扱う |

例えば SBI証券と楽天証券の両方で `eMAXIS Slim 全世界株式` を保有している場合、

- 口座ごとに分けたい → 2つのカテゴリにそれぞれ `SBI証券/eMAXIS Slim 全世界株式`、`楽天証券/eMAXIS Slim 全世界株式` を設定する
- まとめたい → 1つのカテゴリに `eMAXIS Slim 全世界株式` を設定する（両口座の評価額を合算する）

### 同一口座内に同名の銘柄が複数行ある場合

同じ証券口座で同じ銘柄を旧NISA・新NISA、つみたて投資枠・成長投資枠などに分けて保有していると、Zaimの証券詳細ページには**同じ銘柄名の行が複数並ぶ**。Zaimはどの行がどの口座区分かを表示せず、行の属性にも情報がないため、**表示順でしか区別できない**。

銘柄名は証券会社由来で利用者が変えられないため、**同じZaim表示名を複数のカテゴリへ設定するだけで、表示順に1行ずつ自動で割り当てる**。`#N` を手で書く必要はない。

```
旧NISA オルカン   → SBI 証券/eMAXIS Slim 全世界株式(オール・カントリー)
新NISA オルカン   → SBI 証券/eMAXIS Slim 全世界株式(オール・カントリー)   ← 同じ値でよい
```

上のカテゴリから順に、証券詳細ページの1行目・2行目が割り当てられる。カテゴリの順番は表示設定の並び順（`valuationOrder`）で決まる。逆だった場合は表示設定で2つの順番を入れ替える。

- 同じ表示名のカテゴリが**1つだけ**なら、従来どおりその口座の同名行の**合計**になる
- 行数よりカテゴリが多い場合、余ったカテゴリには何も割り当てない
- 割り当てる行が無い名称（銀行口座名など）を複数カテゴリに設定した場合は、先の1件だけに反映する

順番を明示したい場合は `口座名/銘柄名#1` のように `#N` を書ける。手で書いた指定が優先される。`unmatched` も、同名行が複数ある銘柄は `#N` 付きで返す。

**表示順が変わると対応がずれる。** 銘柄の新規購入や全額売却で行が増減した場合は、表示設定の「テスト読み込み」で `entries` を確認してから運用を再開する。Zaimが口座区分を表示するようになれば、順番指定に頼らない対応付けへ変更できる。

### 二重計上の防止

同じ資産を複数のカテゴリへ重複して反映しないよう、次のルールで上位に消費された項目を下位の候補から除外する。

- 銘柄を1件でも反映した証券口座は、残高一覧側の口座合計を対応付け対象から外す（`unmatched` にも出さない）
- ある銘柄の一部だけを `口座名/銘柄名` で対応付けた場合、残りの口座分は `銘柄名` だけの alias で合算しない（残りは `unmatched` として報告する）

### 名称の表記ゆれ

ZaimのDOMは名称の途中で要素が分かれて空白・改行が混ざることがあるため、比較時は空白をすべて除去する。`楽天カー ド` と `楽天カード`、`楽天証券 / eMAXIS Slim 全世界株式` と `楽天証券/eMAXIS Slim 全世界株式` はいずれも一致する。

`valuationAlias` は `,`・`、`・`|` 区切りで複数の名称を設定できる。1つのカテゴリに複数が一致した場合は合算する。

一致しない項目は保存せず、`unmatched` として返す。証券銘柄は `口座名/銘柄名` の表記で返るため、そのまま `valuationAlias` へ貼り付けられる。

### テスト読み込み

対応付けの確認は、評価額更新画面の「表示設定」にある**「テスト読み込み」ボタン**が使える。

- **保存前の編集中のZaim表示名で判定する。** 入力してすぐ結果を確認でき、保存とやり直しを繰り返す必要がない
- 「反映される項目」に、どのカテゴリへどのZaim名称からいくら入るかが出る
- 「未対応のZaim項目」に、どの表示名にも一致しなかった名称が出る。コピーボタンでそのままZaim表示名へ貼り付けられる
- DBへは一切書き込まない

## 6. 画面から取得する

### 利用できるユーザーの制限

Zaimのstorage stateはサーバー上に1つしか持てないため、誰でも取得ボタンを押せると**他人のZaim残高が自分の資産として反映できてしまう**。これを防ぐため、`ZAIM_SYNC_USER_EMAIL` に設定したメールアドレスのユーザーだけが操作できる。

```env
# 「,」区切りで複数指定できる
ZAIM_SYNC_USER_EMAIL=owner@example.com
```

未設定の場合は誰も使えない。許可されていないユーザーには取得ボタンもテスト読み込みボタンも表示せず、サーバー側でも実行を拒否する。

ユーザーごとにZaimを連携できるようにするまでの暫定措置。


評価額更新画面の「Zaimから取得」ボタンで取得する。ボタンからの取得はDBへ保存せず、必ず利用者の確認を挟む（自動保存は後述の定期実行だけが行う）。

押すとZaimを巡回し、`valuationAlias` と対応付いた値を**評価額の入力欄へ反映する**。この時点ではDBへ保存しない。合計・前回差分を確認したうえで「保存」を押して確定する。想定と違う値が入っていれば、保存前に修正・破棄できる。

対応付かなかった項目は保存されない。何が取得できたかを一覧で確認したい場合は、後述のdry-runを使う。

巡回は証券口座の数に応じて時間がかかる（4口座・20銘柄で約12秒）。

## 7. コマンド・APIから取得する

対応付けの初期設定や動作確認には、DBへ書き込まないdry-runを使う。`unmatched` に返る名称を `valuationAlias` へ設定する作業を、一致がなくなるまで繰り返す。

```bash
# VPS・ローカルのコマンドライン（シークレット不要）
npx -y tsx scripts/zaim-sync.ts --dry-run
npx -y tsx scripts/zaim-sync.ts
# 画面のボタンと同じく、当日の評価額があっても必ず上書きする
npx -y tsx scripts/zaim-sync.ts --overwrite
```

`scripts/zaim-sync.ts` は定期実行のエントリでもあるため、`--overwrite` を付けない限り
「当日の評価額があれば上書きしない」「直近の評価額から±50%を超える値は保存しない」で動く（後述）。

`ZAIM_SYNC_USER_EMAIL` か `ZAIM_BALANCE_URL` が未設定の場合は、何もせず正常終了する。
`ZAIM_SYNC_USER_EMAIL` を「,」区切りで複数指定した場合、コマンド・APIからの実行は
**先に書かれたアドレスのユーザー**を同期対象にする（`findZaimSyncUser`）。

HTTP経由でも実行できる。外部から任意のタイミングで叩きたい場合はこちらを使う
（毎日の定期実行はコマンド側で行う。「9. 毎日の定期実行」を参照）。

```env
ZAIM_SYNC_SECRET=<十分に長いランダム文字列>
ZAIM_SYNC_USER_EMAIL=<Asset Managerのユーザーメールアドレス>
```

```bash
curl -X POST -H "Authorization: Bearer $ZAIM_SYNC_SECRET" \
  "https://<asset-manager>/api/zaim/sync?dryRun=1"
```

`entries` に「どのカテゴリへ、Zaim側のどの名称から、いくら反映されるか」が、`unmatched` に「どの alias にも一致しなかった名称」が返る。`dryRun` を外すと実際に保存する。成功時は `updated`、`skipped`、`skippedEntries`、`unmatched`、`entries` をJSONで返す。

## 8. セッション維持

### なぜ必要か

2026-08 時点で実測した各Cookieの役割は次のとおり。

| Cookie | ドメイン | 有効期間 | 役割 |
| --- | --- | --- | --- |
| `_y` | zaim.net | 2時間（**アクセスのたびに延長**） | Zaimのセッション。これがあれば巡回できる |
| `kf` | zaim.net | 約1時間（延長されない） | ログイン処理で発行される。巡回には不要 |
| `kufu` | id.kufu.jp | 約1時間（延長されない） | くふうIDの認証。巡回には不要 |

重要なのは `_y` だけで、**アクセスするたびに有効期限がその時点から2時間後へスライドする**。`kf` と `kufu` が失効して消えたあとでも巡回できることを確認している。

そのため巡回に成功するたびに、更新後のCookieをstorage stateへ保存し直している。

問題は、取得を画面のボタン任せにすると**前回から2時間以上空いた時点で必ず失効する**こと。失効すると `id.kufu.jp/signin` へリダイレクトされ `ZAIM_SESSION_EXPIRED` で失敗し、復旧にはGUIのある端末での再ログインが必要になる。VPS上ではこれを自動で行えない。

### 維持専用ジョブ

そこでPM2のcronで `scripts/zaim-keep-alive.mjs` を1時間ごとに実行する（`ecosystem.config.js` の `asset-manager-zaim-keep-alive`）。残高画面を1ページ開いてCookieを保存し直すだけで、評価額の取得も保存も行わない。

**間隔を1日1回にはできない。** 有効期間が2時間のため、24時間後には必ず失効している。90分でも1回失敗すると次回が3時間後になり失効するため、1回の失敗を吸収できる1時間を採用している。

`ZAIM_BALANCE_URL` が未設定の場合は何もせず正常終了するため、未設定の環境へデプロイしても失敗しない。

PM2のプロセスはVPS上の `.env` を自動で読み込まないため、Nodeの `--env-file-if-exists=.env` で読ませている（`ecosystem.config.js` の `args`）。`.env` が無い環境でも起動できる。

### VPSでの準備

VPSにも初回だけ次の準備が必要になる。

1. Playwrightとchromiumをインストールする（「1. Playwrightの準備」と同じ）
2. GUIのある端末で `node scripts/zaim-login.mjs` を実行し、生成された `.zaim/storage-state.json` をVPSのアプリディレクトリへ安全な方法で配置する
3. `ZAIM_*` をVPSの `.env` に設定する（デプロイで `.env` は削除されないが、GitHub Actions経由で配布する場合は1Passwordへの項目追加と `.github/deploy.env.tpl`・`deploy.yml` への追記が必要）

`.zaim/` はデプロイ時のクリーンアップ対象に含まれないため、配置後はデプロイしても残る。

## 9. 毎日の定期実行

評価額は毎日 **23:30（JST）** にPM2のcronで自動取得する（`ecosystem.config.js` の
`asset-manager-zaim-sync`）。実体は `scripts/zaim-sync.ts` で、画面のボタンと同じ巡回・
対応付けを行い、結果をそのままDBへ保存する。

```
npx -y tsx --env-file-if-exists=.env scripts/zaim-sync.ts
```

PM2のプロセスはVPS上の `.env` を自動で読み込まないため、Nodeの `--env-file-if-exists` を
tsx経由で渡している（`ZAIM_*` は `.env` にしか無い）。tsxは未知のフラグをそのままNodeへ渡す。

23:30にしているのは、その日の値が出揃ったあとに1日の締めとして記録するため。日付は
`normalizeRecordDate` でJSTの当日に丸められるので、日をまたぐ時刻にはしない。

**cronの発火時刻はサーバーのタイムゾーンで決まる。** PM2の `cron_restart` はPM2デーモン側で
評価されるため、`env_production` に `TZ` を書いても発火時刻は変わらない。本番VPSは
`timedatectl set-timezone Asia/Tokyo` を実施済みで（`guchi-apps/vps` の `docs/initial-setup.md`）、
JSTで発火する前提。サーバーのタイムゾーンを変える場合は、記録日（JST固定）とずれるため
この時刻も見直すこと。

巡回時間は証券口座4・銘柄20で約12秒、`lib/zaim-scraper.ts` のタイムアウトは5分あるため、
口座・銘柄が数倍になっても余裕がある。現時点でタイムアウトの変更は不要。

### 確認する人がいないぶんの安全策

画面のボタンは「取得 → 合計・前回差分を目視 → 保存」の2段階だが、定期実行にはその確認が無い。
`valuationAlias` の対応付けミスや、同一口座内に同名銘柄が複数ある場合の表示順ずれが、
そのままDBへ入るのを防ぐため、定期実行では次の2つを必ず通す（判定は `lib/zaim-sync-policy.ts`）。

| 状況 | 挙動 |
| --- | --- |
| その日の評価額がすでにある | 上書きせずスキップする（手動で入力・修正した値を優先する） |
| 直近の評価額から±50%を超えて動いた | 保存せずスキップして通知する（閾値は `lib/valuation-diff.ts` の `LARGE_VALUATION_DIFF_RATIO`） |

- 比較の基準は「当日分があればその値、無ければ前日以前の直近の評価額」。初回の記録で基準が無い場合は比較せず保存する
- コマンドラインから意図的に上書きしたい場合は `--overwrite` を付ける
- `/api/zaim/sync` は従来どおり上書きし、異常値検知も行わない（呼び出し側が結果を確認できるため）

### 失敗・スキップの通知

`SIGNALY_ZAIM_SYNC_WEBHOOK_URL` を設定すると、次の場合にSignalyへ通知する。未設定なら通知を
スキップして正常終了するため、設定していない環境でも失敗しない。

- 巡回・保存が例外で失敗した（セッション切れは専用の文面で通知する）
- 異常値・保存失敗で保存を見送った項目があった

「当日の評価額がすでにある」ためのスキップは想定内の動作なので、ログにだけ出して通知しない。

値は他のSignaly通知と同じ配布経路に載せている（`ZAIM_*` のような手作業ではない）。
1Password（人が管理する唯一の正）→ `.github/secrets-manifest.tsv` → GitHub Secrets →
`deploy.yml` の `env:` → VPSの `.env` の順に配られる。1Passwordの項目は
`op://apps/AssetManager/zaim-sync-webhook-url`。値を変えたときは
`scripts/sync-github-secrets.sh` でGitHub側へ同期する。

### デプロイ直後の1回

PM2の `cron_restart` は登録時にもプロセスを1度起動するため、デプロイ直後に1回実行される。
上書きしない設定のため、その日の評価額がすでにあれば何も書き換わらない。

## セキュリティ

- `.zaim/storage-state.json` はパスワード相当の秘密情報として扱う
- Web公開ディレクトリには置かない
- Gitへコミットしない
- 同期エンドポイントは `ZAIM_SYNC_SECRET` のBearer認証を必須とする
- Zaim側で追加認証やCAPTCHAが表示された場合、それを回避する自動化は行わない
