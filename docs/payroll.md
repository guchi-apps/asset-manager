# 給与・賞与（明細ラボからの移管）

Issue #714 で、明細ラボ（`guchi-apps/meisai-lab`）の給与・賞与の管理と給与明細PDFの取り込みを
Asset Manager へ移した。移管元は meisai-lab の develop（`e2e89e1`、2026-10-11 時点）。
統合全体の計画は親Issue #713、既存データの移行は #717、年次税務は #716 で扱う。

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

## 移管しなかったもの

- 給与の住民税欄の自動計算の目安。移管元は年次税務データ（確定申告・控除）から算出しており、そのモデルは #716 で移す。
  それまでは住民税を手入力する
- 年次税務・ふるさと納税・確定申告の画面（#715・#716）
