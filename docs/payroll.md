# 給与・賞与（明細ラボからの移管）

Issue #714 で、明細ラボ（`guchi-apps/meisai-lab`）の給与・賞与の管理と給与明細PDFの取り込みを
Asset Manager へ移した。移管元は meisai-lab の develop（`e2e89e1`、2026-10-11 時点）。
統合全体の計画は親Issue #713、既存データの移行は #717（手順は `docs/meisai-lab-migration.md`）、年次税務は #716 で扱う。

## 画面

サイドバーの「給与」から入り、上部の共通タブで切り替える（`lib/nav-sections.ts` の `PAYROLL_TABS`）。

| URL | 内容 | 移管元 |
|---|---|---|
| `/salaries` | 給与一覧。年の集計カード・推移グラフ・月別/年別の一覧と項目内訳 | `/salaries` |
| `/salaries/new` | 給与の登録。上にPDF取り込みのカードが出る | `/salaries/new` |
| `/salaries/[id]/edit` | 給与の編集 | `/salaries/[id]/edit` |
| `/bonuses` ほか | 賞与の一覧・登録・編集 | `/bonuses` ほか |
| `/salaries/settings` | 支給・控除の項目と保険料率 | `/settings/items`・`/settings` の保険料率 |

ふるさと納税（#715）・年次税務（#716）もメニューを増やさず、`PAYROLL_TABS` にタブとして足す。
年別表示の「◯年の税務（準備中）」は #716 で税務画面ができたらリンクに差し替える
（`components/payroll/payroll-summary.tsx` の `TaxYearLink`）。

## 資産・Zaimとの関係

給与・賞与は資産（`Asset`）・取引（`Transaction`）・Zaimとは**独立した記録**。給与を登録しても
評価額・入金取引・Zaimの収入は作らないし、資産の画面の再検証もしない。給与の振込を資産に反映するのは、
これまでどおりZaimの自動取得か手入力で行う（二重計上を避けるため）。

## データの形（#717 の移行で崩さないこと）

モデルは `Salary`・`Bonus`・`PayItem`（移管元の `Item`）・`TaxSetting`。id は移管元と同じ cuid。

- `Salary.data` / `Bonus.data` の固定キー（`baseGrossSalary`・`overtime`・`healthInsurance` など）は移管元と同じ。
  **控除はマイナスで持つ**（年末調整・所得税(差額)の項目だけは符号をそのまま持つ）
- `data.customItemValues` は **`PayItem.id` をキーにした金額**。移行で項目の id を振り直すと、
  明細の金額がどの項目のものか分からなくなる。`PayItem` は移管元の `Item.id` のまま写すこと
- `data.itemSnapshots` は保存時点の項目定義の写し。項目の名前・種別・課税対象を変えても、過去の明細は
  写しで集計する（`lib/payroll/item-snapshot.ts`）。写しはサーバーだけが組み立て、クライアントが送った値は捨てる
- 賞与の手取額は列ではなく `Bonus.data.netAmount` に持つ
- 支給日は日付入力の値を UTC の0時として持つ。同じユーザー・同じ支給日は1件まで（論理削除した行は登録時に取り除く）

## 保存の約束

- 同じ支給日の明細がすでにあれば保存せず、理由を返す（`lib/payroll/service.ts`）。既存の明細は変わらない
- 編集画面は、明細に金額がある項目を無効・適用範囲外・削除済みでも読み込む（`lib/payroll/editable-items.ts`）。
  メモだけを直して保存しても、その項目の金額は消えない
- すべての読み書きを `userId` で絞る。他のユーザーの明細は id を知っていても読めず、書き換えられない

## 給与明細PDFの取り込み

`POST /api/salaries/import-pdf` がPDFの1ページ目から「項目名と金額」の行を読み取って返す（PDFは保存しない）。
反映先の割り当て・照合・フォームへの反映はクライアントで行い、保存は利用者が「登録する」を押したときだけ。
読み取りに失敗しても明細には何も書き込まない。手で選んだ反映先はブラウザの `localStorage`
（`asset-manager:payslip-pdf-assignments`）に端末ごとに記憶する。

PDFの解析は `unpdf`（pdf.js）。日本語の文字コードを読むための CMap を `lib/payroll/pdf-cmaps` に置いている。
`public/` に置くとPWAの事前キャッシュ（serwist）に約430KB載るため、デプロイ資材に含まれる `lib/` の下にした。

## 給与明細の代理登録API（#791）

AIDE/MCPが、本人が指定した1件の給与明細PDF（メール添付）を、本人の承認を挟んで給与へ登録するための口。
画面の取り込みと同じ解析（`readPayslipPdf`）・割り当て（`suggestDestination`・`buildFormValues`）・
金額の計算（`lib/payroll/salary-payload.ts` の `buildSalaryPayload`。給与フォームも同じ関数で保存内容を作る）を使い、
別の金額解釈を作らない。判定は `lib/payroll/agent-import.ts`、DBとの処理は `lib/payroll/agent-import-server.ts`。

| メソッド・パス | 内容 |
|---|---|
| `POST /api/salaries/agent/preview` | PDFを読み、保存する内容・照合結果・保存を止める理由を返す。DBには書かない |
| `POST /api/salaries/agent/commit` | 本人が承認したプレビューと同じ内容なら登録する |
| `GET /api/salaries/agent/[id]` | 登録後に実レコードを照合する読み取り専用の口 |

### 認証と所有者

- `Authorization: Bearer <SALARY_AGENT_SECRET>`。issue-deckの共有トークン `ASSET_MANAGER_SALARY_AGENT_SECRET` があれば
  そちらを優先する。**`ZAIM_SYNC_SECRET` では通らない**（給与専用の権限に分けている）
- 登録先は環境変数 `SALARY_AGENT_USER_EMAIL`（1件）のユーザーに固定。リクエストから userId は受け取らない。
  未設定・該当なしは 503 `owner_not_configured`
- 明細ラボからの切替（`MEISAI_LAB_CUTOVER=1`）前は、他の給与の画面と同じく 404
- `/api/salaries/agent/` 配下はセッション検証から外している（`lib/public-paths.ts`）。守りは route 側のBearerだけ

### 送るもの

PDFはbase64（`pdfBase64`、2MBまで）で送り、エージェント側で抽出した金額は受け取らない。PDFはメモリ上で読むだけで保存しない。
`source` はメールの安定ID（`mailbox`・`messageId` 必須、`uidValidity`・`uid` は任意）で、DBにはそのSHA-256だけを
`SalaryAgentImport.sourceKey` として残す。**パスワード付きのPDFは受け付けない**（422 `needs_password`）。
パスワードをチャットやAPIで受け渡さず、本人が `/salaries/new` で取り込む。

### プレビュー → 承認 → 保存

1. `preview` に `{ pdfBase64, source }` を送る。返り値の主なもの
   - `salaryDate.candidate`: PDFの年月＋前回の支給日の「日」から**推測した**支給日。`confirmed` は常に false
   - `lines`（項目ごとの反映先）・`unassignedLabels`・`totals`（計算値・PDFの総支給/差引支給・差）
   - `blockers`: 保存を止める理由（年月不明・未割当・基本給なし・合計行なし・合計不一致）
   - `existing`: 同じメールで登録済みの明細・推測した支給日と同じ日の明細・同じ月の明細
   - `previewToken`（30分有効）・`contentHash`・`canSave`
2. 本人に内容と支給日を確かめてもらう（AIDE側の責務）
3. `commit` に `{ pdfBase64, source, previewToken, approved: true, salaryDate: "yyyy-MM-dd" }` を送る。
   PDFを読み直して内容ハッシュ（PDF・取り込み元・年月・保存内容）を作り直し、トークンと違えば 409 `preview_mismatch`
   （確認後のPDFの差し替え・項目の定義の変更を拒む）。`salaryDate` は明細と同じ年月の日付だけ受け付ける

| commit の結果 | HTTP | 内容 |
|---|---|---|
| `created` | 201 | `salaryId`・`readPath`（`GET /api/salaries/agent/[id]`）・`contentHash` |
| `already_imported` | 200 | 同じメールから登録済み。既存の `salaryId` を返し、何も書かない |
| `date_conflict` | 409 | 同じ支給日の明細がある。既存の `salaryId` を返し、上書きしない（直すのは画面の編集） |
| `blocked` | 422 | `blockers` があるため保存しない。`manualImportPath` へ案内する |
| `approval_required` / `salary_date_invalid` / `preview_invalid` | 400 | |
| `preview_expired` / `preview_mismatch` | 409 | プレビューからやり直す |
| `forbidden` | 403 | 別のユーザーに発行したプレビュー |

再送・タイムアウト後の再試行・並行した同じ依頼は `already_imported` になる（`SalaryAgentImport` の
`(userId, sourceKey)` 一意制約と、明細と同じトランザクションでの作成）。登録した明細を本人が削除したあとに
同じメールを送り直すと、登録し直せる。

### 機微情報

ログに残すのは明細のID・状態・エラー名だけ。金額・項目名・PDF・Bearerの値は出さない（`runSalaryAgent` は
Prismaのエラーも名前だけを出す。Prismaのエラー文は引数の値を含みうるため）。

**pdf.js（`readPayslipPdf`）は渡したバイト列を読み取り中に転送（detach）して空にする。** 読み取ったあとで
同じ `Uint8Array` からハッシュを取ると、どのPDFでも空データのハッシュになり、すり替えを検知できない
（#791 の実装中に実際に踏んだ）。PDFのハッシュは読む前に取る。

## 移管しなかったもの

- 給与の住民税欄の自動計算の目安。移管元は年次税務データ（確定申告・控除）から算出しており、そのモデルは #716 で移す。
  それまでは住民税を手入力する
- 年次税務・ふるさと納税・確定申告の画面（#715・#716）
