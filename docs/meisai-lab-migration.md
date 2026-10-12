# 明細ラボからの既存データの移行と切替（Issue #717）

#714（給与・賞与）・#715（ふるさと納税）・#716（年次税務）で明細ラボ（`guchi-apps/meisai-lab`）の機能を移した。
このページは、**明細ラボの本番データを Asset Manager へ写し、更新先を Asset Manager に一本化する**ための
仕組みと手順をまとめる。統合全体の計画は親Issue #713。

**本番での移行・旧アプリの停止はまだ行っていない**（「本番での実施状況」を参照）。実装エージェントは本番DBへ
接続しないため、手段（移行コマンド）と手順だけを用意し、検証用のローカルDBで確かめている。

## 移すもの

| 移行元（明細ラボ） | 移行先（Asset Manager） | 備考 |
|---|---|---|
| `Item` | `PayItem` | 名前だけが違う。列は同じ |
| `TaxSetting` | `TaxSetting` | 適用開始年月・料率（小数点以下4桁）・式 |
| `Salary` | `Salary` | `data`（JSON）・メモ・論理削除（`deletedAt`）を含む |
| `Bonus` | `Bonus` | 手取額は `data.netAmount` |
| `Deduction` | `Deduction` | `furusatoNozei` は寄付明細に載せていない調整額（`docs/tax-return.md`） |
| `TaxCalculationOverride` | `TaxCalculationOverride` | 手入力の上書き値。全項目そろうと「確定済み」 |
| `FurusatoDonation` | `FurusatoDonation` | 申請・証明書の状態・受取期間（片側だけも可）・論理削除を含む |

`User` は写さない（下の「アカウントの対応付け」）。資産・取引・Zaim連携のデータには触れない。

**行は id を変えずに写す。** 移行先のモデルは #714〜#716 で列名・id の方式（cuid）を移行元と同じにしてある。
`Salary.data` / `Bonus.data` の `customItemValues`・`itemSnapshots` は項目の id をキーにしているので、
id を保てば JSON の中の参照を張り替えずに済む（`docs/payroll.md` の「データの形」）。旧画面の編集URL
（`/salaries/<id>/edit` など）も、移行先で同じ id のまま開ける。

作成・更新日時も移行元の値を写す。金額は `Decimal` のまま（浮動小数点を通さない）、日時は UTC のまま写す。

## 移行コマンド

```bash
npm run meisai:migrate -- preview  [--source-db <DB名>] [--user <移行元のメール>]... [--map <移行元User.id>=<移行先User.id>]...
npm run meisai:migrate -- apply    （preview と同じオプション）
npm run meisai:migrate -- verify   （preview と同じオプション）
npm run meisai:migrate -- rollback [--user <User.id>]... [--execute]
```

| コマンド | 何をするか | 書き込み |
|---|---|---|
| `preview` | アカウントの対応・モデルごとの作成/更新/削除/衝突の件数・移行先の既存データ・項目参照の不明を表示する | しない |
| `apply` | preview と同じ判定をし、**対応不明のユーザーか衝突が1件でもあれば何も書かずに止まる**。問題が無ければユーザーごとに1トランザクションで書く | する |
| `verify` | ユーザー×モデル×年で、件数（有効・削除済み）と金額合計を移行元と突き合わせる。行ごとの内容も比べる | しない |
| `rollback` | 移行で入れた行を消す。既定は確認だけで、`--execute` で消す | `--execute` 時のみ |

- **移行元**は `MEISAI_LAB_DATABASE_URL`、または `--source-db <DB名>`（`DATABASE_URL` のDB名だけを差し替える。
  両アプリは同じDBサーバーを使っている）。移行元へは **SELECT しか発行しない**（読み取り専用トランザクションの中で
  全テーブルを同じ時点で読む）。`rollback` は移行元へ接続しない
- **移行先**は `DATABASE_URL`（他のスクリプトと同じ）
- `--user` はデータを持つ移行元ユーザーをメールか id で絞る。対応不明のユーザーが残っていても、確認できた人だけ先に移せる
- 実行ごとに `.meisai-migration/<日時>-<コマンド>.json` へレポートを書く（`.gitignore` 済み）。`preview` / `apply` は
  **移行元の全行と、移行先の書き込み前の行の写し**を含む（バックアップを兼ねる）。金額・メモが入るのでコミットしない。
  移行が済んだら消す
- 実装は `scripts/meisai-lab-migration.ts`（入出力）と `lib/meisai-migration/`（判定。単体テストあり）

### アカウントの対応付け

`User.id` は両アプリで別物で、同じ値とは限らない。両アプリは同じ Supabase プロジェクトを使っているので、
**`supabaseUserId` とメールアドレスの両方が一致したときだけ**同一人物とみなす（`lib/meisai-migration/accounts.ts`）。
次の場合は「対応不明」として、そのユーザーのデータを一切書かない。

- Asset Manager に同じユーザーがいない → **先に Asset Manager へ一度ログインする**（User はログイン時に作られる）
- メールは一致するが `supabaseUserId` が違う → Supabase のユーザーが作り直された可能性（#641）。両アプリの
  `User` を見比べて同一人物だと確認できたら `--map <移行元User.id>=<移行先User.id>` で指定する（メールの一致は引き続き求める）
- `supabaseUserId` は一致するがメールが違う／移行元に `supabaseUserId` が無い／2人が同じ移行先へ向かう

### 再実行・差分取り込み・衝突（取り込み記録）

`apply` は写した行ごとに `LegacyImportRecord` を1件残す。移行元のどの行をどの行へ写したかと、**写した時点の
内容のハッシュ**（userId・作成/更新日時を除く）を持つ。これで、移行元と移行先のどちらが変わったのかを見分ける
（`lib/meisai-migration/plan.ts` の表）。

| 状況 | 結果 |
|---|---|
| 同じ移行をもう一度流した | 変更なし（記録も合計も増えない） |
| 移行後に旧アプリで直した・論理削除した | 移行先を更新する（差分取り込み） |
| 移行後に旧アプリで物理削除した（項目・料率・控除・上書き値は物理削除） | 移行先の行も消す |
| 移行後に新アプリで直した・消した | 移行先を残す（旧アプリの値で巻き戻さない）。preview に「移行先を維持」と出る |
| 両方で違う内容に直した | **衝突** |
| 移行先に、移行と無関係な同じキーの行がある（同じ支給日の明細・同名の項目・同じ適用開始月の料率・同じ年と種類の控除。論理削除した明細も含む） | **衝突** |
| 移行先に同じ id の行が記録なしで、別の内容である／別のユーザーが持っている | **衝突** |

衝突は自動で合わせない。preview の表示（どの行が・何とぶつかったか）を見て、どちらを残すかを人が決め、
移行先の行を直すか消してから流し直す。ふるさと納税の寄付には一意制約が無い（同じ日に同じ自治体へ複数回寄付できる）ため、
id でしか突き合わせない。

### 途中で失敗したとき

書き込みはユーザーごとに1トランザクションで、書いたあとに移行先を読み直して内容が移行元と一致するかを確かめる
（一致しなければ投げて巻き戻す）。途中で失敗したユーザーは丸ごと巻き戻るので、**原因を取り除いて同じコマンドを
流し直せば再開できる**（済んだユーザーは「変更なし」になる）。`--fail-after <N>` は、各ユーザーの書き込みを N 件
行ったところで失敗させる動作確認用のオプション。

## 切替の手順

旧アプリ（`https://meisai.gucchii.com`）と新アプリ（`https://asset.gucchii.com`）の**両方で更新し続ける状態を作らない**ことが目的。
切替前は旧アプリが正本で、旧アプリから最新データを見られる。切替後は Asset Manager が正本になる。

### 0. 事前確認（本番DBに書かない）

1. このIssueのマイグレーション（`LegacyImportRecord`）を含むリリースが本番に出ていること
2. 移行する利用者が **Asset Manager へ一度ログインしている**こと
3. 本番で `preview` を流し、本番の件数・アカウントの対応・衝突の有無を確認する（**未実施**。下の「本番での実施状況」に結果を記録する）

```bash
# 本番DBへの接続は prod:tunnel と同じ経路（サブPCから。手順は package.json の tunnel:start）
npm run tunnel:start
op run --env-file=.env.1password.prod.tpl -- bash scripts/construct-database-url.sh \
  npm run meisai:migrate -- preview --source-db <明細ラボの本番DB名>
```

明細ラボの本番DB名は、1Password の明細ラボの項目（GitHub の meisai-lab リポジトリの `DB_NAME` と同じ値）。
両アプリは同じDBサーバー・同じDBユーザー（`SHARED_DB_USER`）を使う前提で、`--source-db` は Asset Manager の接続情報の
DB名だけを差し替える。**このDBユーザーで明細ラボのDBを読めるかは未確認**。読めなければ `MEISAI_LAB_DATABASE_URL` に
明細ラボの接続URLを渡す。

### 1. バックアップ

両方のDBを、VPS上で `mysqldump --single-transaction` で取る（明細ラボのDB・Asset ManagerのDB）。
`preview` / `apply` のレポートにも行の写しが残るが、DB全体の復旧にはダンプを使う。

### 2. 初回の取り込み（旧アプリはまだ正本）

1. `apply` → `verify`。`verify` が「すべて一致しました」になることを確かめる
2. Asset Manager の「給与」「賞与」「ふるさと納税」「税務」画面で、移した年の件数・合計が明細ラボの画面と合うことを目で確かめる
3. この時点ではまだ旧アプリが正本。**Asset Manager 側で移したデータを編集しない**（編集すると、次の差分取り込みで
   「移行先を維持」か衝突になる）

### 3. 旧アプリの更新停止

明細ラボを読み取り専用にする（登録・編集・削除・PDF取り込みを止め、画面に Asset Manager への案内を出す）。
**明細ラボ側の変更が要る**ため、別Issueで扱う（下の「残っていること」）。

### 4. 差分取り込みと照合

更新停止の直前までに旧アプリで入力・修正・削除された分を、`apply` をもう一度流して取り込む。
続けて `verify` を流し、全モデルが一致することを確かめる。新アプリで直した行は「移行先を維持」と出て、照合でも
差分として報告される（意図した差分か確かめる）。

### 4.5 新画面の公開（`MEISAI_LAB_CUTOVER`）

移した画面（`/salaries`・`/bonuses`・`/furusato`・`/tax`・`/api/salaries/*`）は、本番の環境変数 `MEISAI_LAB_CUTOVER=1` が
無い間、メニューから外れ、直接開いても404、サーバーアクション・PDF読み取りAPIも拒否する（`lib/meisai-cutover.ts`・
`middleware.ts`。#736）。移行前に公開すると、新テーブルが空のまま過去の記録が見えず、新旧の更新先が割れるため。
**手順4の照合が済み、旧アプリを読み取り専用にしたあとで、本番の環境変数を設定して公開する。**

設定の経路（`.github/secrets-manifest.tsv`・`.github/workflows/deploy.yml`）: このリポジトリの GitHub variable `MEISAI_LAB_CUTOVER` が、
デプロイ時にサーバーの `.env` へ書き込まれる（1Password・secretsは使わない。未設定は空で、画面は閉じたまま）。

```bash
# 切替時: 値を1にして再デプロイする（.env はデプロイ時にしか更新されない）
gh variable set MEISAI_LAB_CUTOVER --body 1 --repo guchi-apps/asset-manager
gh workflow run deploy.yml --repo guchi-apps/asset-manager --ref main   # deploy.yml の手動実行
# 再デプロイ後、/salaries が開き、サイドバーに「給与」が出ることを確かめる
# 切戻し: gh variable delete MEISAI_LAB_CUTOVER --repo guchi-apps/asset-manager のあと再デプロイ
```

### 5. 更新先の切替

- 以降の入力は Asset Manager だけで行う
- 旧URLから新しい画面へ案内する（下の「旧URLの対応」）。転送の設定は vps リポジトリ（Apache）側の変更
- スマホのホーム画面に追加した明細ラボのPWAは、利用者が手で外し、Asset Manager を追加する

### 6. 切戻し

- **切替の前（手順5より前）**: `rollback`（確認）→ `rollback --execute` で、移行で入れた行だけを消す。旧アプリのDBは
  一度も書き換えていないので、明細ラボの更新停止を解けば元に戻る
- **切替の後**: 新アプリで変更した行があると、`rollback` は何も消さずに止まり、その行を一覧する（新アプリで入力した分を
  黙って失わないため）。新アプリで入力した分を旧アプリへ戻す仕組みは無いので、レポートと画面を見て人が判断する
- どの段階でも、DB全体はバックアップ（手順1）から戻せる

### 7. 旧アプリ・旧DBの扱い

**旧DBは削除しない。** 停止・撤去（PM2・vhost・証明書・DNS・DB）は、切替後にしばらく様子を見てから別Issueで行う
（subscription-lists の撤去 #543 と同じ順で、DBは最後）。それまで移行コマンドと `LegacyImportRecord` は残しておく。

## 旧URLの対応

id を保って写すので、編集画面の URL も id ごと対応する。

| 明細ラボ（`meisai.gucchii.com`） | Asset Manager（`asset.gucchii.com`） |
|---|---|
| `/salaries`・`/salaries/new`・`/salaries/<id>/edit` | 同じパス |
| `/bonuses`・`/bonuses/new`・`/bonuses/<id>/edit` | 同じパス |
| `/furusato`・`/furusato/new`・`/furusato/<id>/edit` | 同じパス |
| `/tax-return`（`?year=`） | `/tax`（`?year=`） |
| `/settings`・`/settings/items` | `/salaries/settings` |
| `/`・`/auth/*` | `/` |

## 外部からの参照の棚卸し（2026-10-12時点）

| 参照元 | 状況 | 対応 |
|---|---|---|
| vps リポジトリ | `apache/sites-available/meisai.gucchii.com*.conf`（vhost）・README と `docs/architecture.md` のアプリ一覧 | 切替後に転送を設定し、撤去時に一覧を更新する（別Issue） |
| issue-deck | `src/lib/release-verification-config.ts`・`scripts/local-repo-ports.conf` などに meisai-lab の登録 | 開発の運用のための登録で、データの参照ではない。撤去時に外す |
| AIDE | `src/core/views/money.ts` のコメントで「将来 meisai-lab（給与）を足す場所」と触れているだけ | **連携は存在しない**。給与を AIDE へ出すなら Asset Manager から出す（未計画） |
| Notion | 「お盆休み AI計画（2026-08）」に統合の構想メモがあるだけ。URLのリンクや連携は見つからない | 対応不要 |
| ops-dashboard・status-hub | ワークフローのコメントや導入状況の表で名前が出るだけ | 対応不要 |
| 利用者の端末 | 明細ラボのPWA（ホーム画面）・ブラウザのブックマーク | 手順5の案内・転送で受ける |

明細ラボの API（`/api/*`）は、どれもログイン中の利用者のセッションで認証しており、外部から呼ぶ口（トークン認証）は無い。

## 本番での実施状況

| 段階 | 状況 |
|---|---|
| 移行コマンド・取り込み記録・手順（このページ） | 用意した（#717） |
| ローカルの検証用DBでの確認 | 済み（下記） |
| 本番の件数・アカウントの対応・衝突の確認（手順0の preview） | **未実施** |
| バックアップ・初回の取り込み・照合 | **未実施** |
| 旧アプリの更新停止 | **未実施**（明細ラボ側の実装が未着手） |
| 差分取り込み・切替・旧URLの転送 | **未実施** |
| 旧アプリの停止・撤去 | **未実施**（旧DBは削除しない） |

### ローカルでの確認（#717）

明細ラボの `origin/develop` のスキーマで作った検証用DBを移行元に、Asset Manager のスキーマで作った別の検証用DBを
移行先にして確かめた。

- 2人ぶんの全7モデル（削除済みの給与・賞与・寄付、写しにしか無い削除済み項目への参照、片側だけの受取期間、
  4桁の料率を含む）を移し、移行元と移行先で列の値・`data` の JSON・作成/更新日時が一致した。`verify` も一致した
- Asset Manager にいないユーザーが含まれると `apply` は何も書かずに止まり、`--user` で絞れば確認できた人だけ移せた
- 2回目の `apply` は書き込み0件で、記録・件数とも増えなかった
- 差分取り込みで、旧アプリの修正・論理削除・物理削除が反映され、新アプリで直した上書き値は残った
- 移行先に同じ支給日の明細があると衝突で止まり、どのユーザーにも何も書かなかった
- `--fail-after` で途中で失敗させると全部巻き戻り、流し直すと続きが入った
- `rollback` は新アプリで直した行があると止まり、`--user` で絞った利用者の分だけを `--execute` で消せた。消したあと取り込み直せた
- 移した利用者の給与・賞与・寄付・税務を Asset Manager の読み出し処理（`lib/payroll/queries.ts`・`lib/furusato/service.ts`・
  `lib/tax/data.ts`）で読み、削除済みの明細が出ないこと・項目名が引けること・他の利用者の明細を読めないことを確かめた
- 移行の前後で、資産（`Asset`）・取引（`Transaction`）・カテゴリの件数と合計は変わらなかった

## 残っていること

- 明細ラボの読み取り専用化と Asset Manager への案内（meisai-lab リポジトリ。手順3・5）
- 旧URLの転送（vps リポジトリの Apache 設定。手順5）
- 本番での手順0〜6の実施と、このページの「本番での実施状況」の更新
- 様子見のあとの旧アプリ・旧DBの撤去と、移行コマンド一式（`scripts/meisai-lab-migration.ts`・`lib/meisai-migration/`・
  `LegacyImportRecord`）の撤去。テストは `package.json` の `test` に列挙してあるので、消すときは列挙も直す
