# 口座の用途（Issue #965）

家計簿の口座（`LedgerAccount`）に `purpose`（投資／貯蓄／生活資金／生活防衛費／負債）を持たせ、
ホームの資産の内訳と、投資資産の画面に出すかどうかを決める。実装は `lib/account-purpose.ts`。

## 有効な用途の決め方（資産カテゴリ単位）

1. カテゴリの `excludeFromInvestmentView` が立っていれば、口座の用途が投資でも**生活防衛費**（負債は負債のまま）
2. 紐づく口座（`LedgerAccount.assetCategoryId`）の用途
3. どちらも無ければ従来のフラグ（`isLiability`→負債、`isCash`→貯蓄、それ以外→投資）

- `hidden` の口座は使わない。同じカテゴリに複数の口座が紐づくときは `order`→`id` の先頭
- 子カテゴリに紐づく口座の用途は親へ伝播し、子は親の用途に従う（集計はトップレベルだけを見る）
- `assetCategoryId` は外部キーを張らない `Int?`。紐付けが無い口座の用途は、どのカテゴリにも効かない

## 表示

- ホーム: 投資／貯蓄／生活資金／生活防衛費の帯と、別帯の負債（`computeAssetBreakdown`）
- 投資資産の画面: 投資用途のカテゴリだけ。履歴は `getFinancialSnapshot` の `investmentHistoryPoints`
  （投資用途のカテゴリだけで計算）を使い、サマリー・グラフ・構成一覧の母集団を揃える。
  「投資以外を含める」トグルは廃止した
- 口座の用途を変えると `revalidateUserDashboard` で集計のキャッシュ（300秒）を捨てる
