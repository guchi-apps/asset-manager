# Project Definition: Asset Manager

## 1. プロジェクト概要
Asset Manager は、ユーザーが手動で評価額と入出金履歴を入力し、「真の取得原価」に基づいた資産推移と損益を可視化するWebアプリケーション。

## 2. 技術スタック
- **Framework**: Next.js (App Router)
- **Styling**: Tailwind CSS, shadcn/ui
- **Database**: MySQL (Prisma ORM)
- **Charts**: Recharts
- **Infrastructure**: AWS Lightsail (Ubuntu) + PM2

## 3. データベース・スキーマ (MySQL / Prisma)
```prisma
datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

// 資産カテゴリ
model Category {
  id           Int           @id @default(autoincrement())
  name         String        // 例: 米国株, ビットコイン
  color        String        // グラフ用カラーコード
  isCash       Boolean       @default(false) // trueの場合、常に損益0として扱う
  isLiability  Boolean       @default(false) // trueの場合、負債として扱う
  tags         Tag[]         // 多対多: 複数のタグ（例:「株式」「ドル建て」）に所属可
  assets       Asset[]
  transactions Transaction[]
}

// 分析用タグ（旧グループ）
model Tag {
  id           Int        @id @default(autoincrement())
  name         String     // 例: 資産クラス, 通貨, リスク資産
  color        String?    // タグごとの固定色（nullの場合は自動割り当て）
  categories   Category[]
  tagGroups    TagGroup[] // このタグが含まれるタググループ
}

// タググループ（グラフ表示用プリセット）
model TagGroup {
  id           Int    @id @default(autoincrement())
  name         String // 例: 「通貨別ポートフォリオ」「リスク資産配分」
  tags         Tag[]  // このグループに含まれるタグの集合
}


// 評価額の履歴 (推移グラフ用)
model Asset {
  id           Int      @id @default(autoincrement())
  categoryId   Int
  category     Category @relation(fields: [categoryId], references: [id])
  currentValue Decimal  @db.Decimal(15, 2)
  recordedAt   DateTime @default(now())
}

// 入出金履歴 (取得原価計算用)
model Transaction {
  id           Int             @id @default(autoincrement())
  categoryId   Int
  category     Category        @relation(fields: [categoryId], references: [id])
  type         TransactionType // DEPOSIT (追加) / WITHDRAW (引き出し)
  amount       Decimal         @db.Decimal(15, 2)
  transactedAt DateTime        @default(now())
}

enum TransactionType {
  DEPOSIT
  WITHDRAW
}
```

## 4. コア・ロジック：取得原価（Cost Basis）の算出
カテゴリごとに履歴を走査し、以下のアルゴリズムで現在の原価を計算する。

**入金（DEPOSIT）が発生した時:**
$$新しい原価 = 直前の原価 + 入金額$$

**出金（WITHDRAW）が発生した時:**
（部分解約に対応するため、損益率を維持して原価を減らす）
$$新しい原価 = 直前の原価 \times (1 - \frac{出金額}{直前の評価額})$$

### 現金カテゴリの特例（isCash = true）
「現金」として設定されたカテゴリは、**常に「取得原価 ＝ 現在評価額」** とみなす。
これにより、入出金履歴の有無にかかわらず、評価損益は常に **0円 / 0%** となる。総資産額には加算されるが、ポートフォリオ全体の損益額には影響を与えない。

## 5. 画面・機能要件

### Dashboard (メイン画面)
- **全体サマリー**: 総資産、総損益額、総損益率の表示。
- **資産構成比**: 現在の時価に基づくドーナツチャート（Recharts）。
    - 集計軸を「カテゴリ別」と「タグ別」で切り替え可能。
    - 保存された「タググループ（View）」を選択して表示切り替え。
- **資産推移**: 過去の資産額変動チャート（Area Chart）。
    - **機能追加**: 「取得原価」のラインを表示し、含み益を可視化。
    - **機能追加**: 「カテゴリ/タグ別」の積み上げチャート（Stacked Area）への切り替え機能。
        - 選択したタググループ内訳の推移を確認可能にする。
- **カテゴリ別一覧**: 各カテゴリの現在値、原価、損益をカード形式で表示。
    - **機能追加**: カードクリックで「資産詳細画面」へ遷移。

### Asset Detail (資産詳細画面) - NEW
- 特定のカテゴリ（資産）にフォーカスしたダッシュボード。
- **個別サマリー**: 対象資産の現在値、原価、損益サマリー。
- **個別資産推移**: 対象資産のみの時価・原価推移グラフ。
- **取引履歴一覧**: 対象資産に関連する Transaction のリスト。

### Rebalance (リバランス画面) `/rebalance`
目標の資産配分を登録し、現在の構成比とのズレ・それを埋めるための売買金額を提示する。

- **集計軸**: 「カテゴリ別」と「タググループ別（資産クラス・通貨など）」を切り替える。
  タグ軸の集計は、カテゴリに直接付いたタグ → 親カテゴリのタグ、の順で解決し（ダッシュボードの
  構成比グラフと同じ規則）、どのタグにも属さない資産は「未分類」にまとめる（目標の設定対象外）。
- **目標配分**: `AllocationTarget` に保存する。`categoryId` を持つ行がカテゴリ軸、`tagOptionId` を
  持つ行がタグ軸。合計100%（誤差0.05以内）でなければ保存できない。すべて空にすると削除になる。
- **母数**: 負債カテゴリを除いた総資産。現金は母数に含める（現金比率も配分のうちとして扱う）。
- **提案**: 計算は `lib/rebalance.ts` の純関数（`buildAllocationRows` / `buildProposal`）に集約する。
    - 買い増しのみ: 追加投資額を、不足している項目に不足額の比率で按分する。不足合計を超えた分は
      目標比率どおりに配る。
    - 売買あり: 目標額との差をそのまま提示する（売り＝マイナス）。
    - 金額は1,000円単位に丸め、丸めで1,000円未満になる項目は「変更しない」に寄せて、
      合計が入力額（売買ありは差額の合計）とずれないように端数を最大の項目で吸収する。
- **「要調整」の判定**: 画面に出るズレ（小数第1位）がしきい値以上のとき。しきい値（3/5/10pt）は
  localStorageに保存する。
- **取引履歴との連携**: 提案から `/transactions?categoryId=..&amount=..` へ遷移すると、
  資産と金額（売却はマイナス）が入った状態で登録ダイアログが開く。
- **銘柄推奨の範囲**: 個別銘柄の保有情報を持たないため、提案の対象は登録済みのカテゴリ・タグに限る。
  未保有の銘柄を新たに勧めることはしない（#98）。

### Inputs (データ入力)
- **評価額更新**: 定期的な時価の入力。
- **履歴登録**: 「いつ」「どのカテゴリに」「いくら入れたか/出したか」の登録。
- **マスタ管理 (Assets)**: 
    - **タグ管理**: タグの新規作成・編集・削除。タグごとの色指定。
    - **カテゴリ設定**: 名称、色、損益0モード、タグ付与（作成済みのタグから選択）。
    - **タググループ設定**: チャート表示用の「タグの組み合わせ（プリセット）」を作成・編集する機能。

### サイドバーメニュー

`components/app-sidebar.tsx` の `navGroups` が唯一の定義。用途ごとのグループに分けて並べる。

| グループ | 項目 |
|---|---|
| （見出しなし） | ダッシュボード |
| 資産 | 資産管理 / 評価額一括更新 / 取引履歴 / 家計簿連携 |
| 分析 | 基準日比較 / リバランス / 指数 |
| 設定 | プロフィール / データ管理 / 設定 |

ログアウトとバージョン表記だけを `SidebarFooter` に置く。現在のページはURLの前方一致でハイライト
する（`/assets` と `/assets/valuation` のように前方一致が重なる場合は、より長いURLを優先する）。

**項目を増やすときの注意（#240）。** スマホでは `Sheet` 表示になり、**スクロールするのは
`SidebarContent` だけで `SidebarFooter` は固定される**。そのため縦に収まらなくなると、末尾の項目が
画面外へ押し出されたうえで区切り線とフッターだけが見え、「メニューはここで終わり」と読めてしまう
（家計簿連携がスマホから見えなくなった原因）。項目は `h-10`・グループ見出しは `h-8` で、
iPhone 15 相当（実効約745px）にちょうど収まる高さになっている。項目を足すときは、既存グループへ
入れたうえで実機の縦幅を確認すること。

## 6. デプロイ設定 (AWS Lightsail / PM2)
- **環境差異**: ローカル開発は WSL 上の MySQL（`127.0.0.1:3306`）、本番は VPS の MySQL。OAuth 等は 1Password で管理し、`.env` には秘密情報を置かない。
- **永続化**: PM2 を使用し、サーバー再起動時にもアプリを自動復旧させる。
