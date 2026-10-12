# 税務確認（年次税務・ふるさと納税試算）

明細ラボの「確定申告データ」（`/tax-return`）をAsset Managerの「給与」配下 `/tax` へ移管したもの（Issue #716、親 #713）。
計算ルール・対応年度は移管元のまま変えていない。

## 画面

- `/tax?year=YYYY` — 対象年を年チップで切り替える。データのある年と、開いている年が並び、任意の年は「年を追加」で開く。
  確定済みの年には「確定」が付く。メニュー項目は増やさず、給与の共通タブ（`PAYROLL_TABS`）に置く。
- 給与・賞与の年ごとの見出しから、同じ年の `/tax?year=` へ進める（`TaxYearLink`）。
- 1年ぶんの内容: 残り枠カード（実績／見込み／寄付済額／上限目安／残り枠）、相談用スナップショット、
  所得税・住民税の計算過程（手動上書き・確定・解除）、年次控除の入力。

## データ

| テーブル | 中身 |
|---|---|
| `Deduction` | 年次控除。`lifeInsuranceGeneral` / `lifeInsuranceCareMedical` / `lifeInsurancePension` / `furusatoNozei`。1ユーザー・1年・1種類で1行 |
| `TaxCalculationOverride` | 計算過程の手動上書き。`RESIDENT_TAX_BREAKDOWN_FIELDS` の全項目が揃うと「確定済み」 |

列名・idの方式（cuid）は明細ラボと同じで、既存データの移行（#717、`docs/meisai-lab-migration.md`）で行をそのまま写せる。
資産（`Asset`）・取引・Zaimには一切書き込まない。全クエリ・全書き込みの `where` に `userId` を入れている。

### 寄付済額の定義（二重計上を避ける）

**`Deduction.furusatoNozei` は「寄付明細に載せていない調整額」だけを意味する。** 寄付済額は

    寄付明細の合計（#715 の `FurusatoDonation`）+ 調整額（`Deduction.furusatoNozei`）

で、`lib/tax/donation.ts` の `withAdjustment` が唯一の合成点。明細の合計を調整額へ書き写してはいけない。
両方に金額があると、画面に二重計上の警告を出す。`furusatoNozeiEffective` の手動上書きがあればその値が優先される（`lib/tax/quota.ts`）。

寄付明細の読み出しは `lib/tax/donation-source.ts` に閉じている。件数・自治体数・未完了件数の数え方は #715 の
`lib/furusato/summary.ts`（`summarizeDonations`）に任せ、税務側の形へ写すだけにしている。ふるさと納税の画面（`/furusato`）も
同じ調整額（`Deduction.furusatoNozei`）を渡すので、両画面の「年間寄付額」は一致する。

## 計算

- `lib/tax/annual-tax.ts` — 所得税・住民税の計算（明細ラボの `annualTax.ts`）
- `lib/tax/aggregate.ts` — 給与・賞与の明細から年間集計と見込みを出す純粋な計算（`annualTaxAggregate.ts`）
- `lib/tax/data.ts` — 年別の読み出し（`annualTaxData.ts`。`db.item` を `db.payItem` に読み替え）

**移管元との差分は import 行だけ**（`./annualTax.ts` → `./annual-tax`、`./itemSnapshot.ts` → `../payroll/item-snapshot`）。
計算式・閾値・年度は変更していない。移管元の単体テスト（`annualTax.test.ts`・`annualTaxAggregate.test.ts`）をそのまま移し、同じ期待値で通る。

### 現行の対応範囲（変えていない）

扶養親族なし／対応する所得控除は給与所得控除・社会保険料・生命保険料3種・基礎控除・寄附金控除のみ／
住民税の均等割・森林環境税は全国標準額（自治体差なし）／給与所得控除・基礎控除は令和7年分以降の式で固定。
住宅ローン控除・医療費控除などは未対応。画面の注意表示と、相談用スナップショットの「計算の前提」に同じ内容を出している。

## 残り枠とスナップショットの整合（移管元との意図した差）

明細ラボでは、残り枠カードは画面の試算値・手動上書きを反映し、スナップショットは別の計算経路だったため、
上書きがある年は上限額・寄付済額がずれ得た。移管後は両方とも次を通る。

- 残り枠: `lib/tax/quota.ts` の `computeQuota`
- スナップショット: `lib/tax/view.ts` の `buildSnapshotFromState`（内部で `computeQuota` を呼ぶ）

試算値（年収・社会保険料）の状態は `TaxYearSection` が1か所で持ち、カードとスナップショットへ同じ値を渡す。
スナップショットには推定／確定の区別（`limitState`・`meta.confirmed`）、寄付明細（日付・金額・ワンストップ／証明書の状況。
自治体名は含めない）、申請・証明書の未完了件数、計算の前提を含める。
明細ラボではダイアログで手入力させていた自治体数・申請済み件数は、寄付明細から数えるため入力欄をなくした。

## テスト・確認

- `lib/tax/annual-tax.test.ts`・`aggregate.test.ts` — 移管元の基準（計算・見込み）
- `lib/tax/tax-view.test.ts` — 寄付明細のみ／調整額併用／未登録月あり／源泉徴収票入力済みで、残り枠とスナップショットが一致すること、二重計上、保存入力の検証
- サーバーアクションは、`CLAUDE.md` の方法（`getCurrentUserId` と `next/cache` を差し替えるローダーフック）でローカルDBへ実行し、
  他ユーザーの控除・上書きを読めない／消せないこと、確定・解除・個別解除、過去年が別年として残ることを確認した。
