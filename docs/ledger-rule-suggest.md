# 分類ルールのAI提案（Issue #1123）

家計簿 › カテゴリ タブの「分類ルール」カードにある「AIのルール提案」。未分類の品目から、
「どの項目（お店・振込名／メモ／品目名）に何を含むなら → どこへ分類するか」のルールをAI（Claude）に提案させ、
1件ずつ採用・見送りを選ぶ。以前の「未分類が多いお店」の一覧（お店ごとにカテゴリを選ぶとお店のルールを作る）を置き換えた。

## 流れ

1. 「ルールを提案してもらう」を押すと `suggestRulesAction`（`app/actions/ledger.ts`）が
   `suggestClassificationRules`（`lib/ledger-rule-suggest-service.ts`）を呼ぶ
2. 未分類の品目を「種別・お店・メモ・品目名」でまとめ、多い順に最大150件ぶんを、今あるルール・カテゴリ（`buildCategoryChoices`）・
   表示中の口座と一緒に渡す。対象の品目は当て直し（`applyClassificationRules`）と揃え、取り込み済み（継続取り込み・CSV）の
   支出・収入から、品目を手直しした取引とレシートを付けた取引を除いたもの
3. 応答は構造化出力（`output_config.format`）で受け、`normalizeRuleSuggestions` で
   存在しないカテゴリ・口座を指すもの、今あるルールと同じもの（見る項目と含む文字の組。並び順・全角半角の違いは同じとみなす）、
   提案どうしの重複を捨て、最大12件に切る
4. `attachSuggestionMatches` で、今あるルールの後ろに足したときに当たる未分類の品目を数え、1件も当たらない提案を捨てる
   （`previewRule` と同じ考え方）
5. 画面では分類先を選び直してから「採用」できる。採用は手入力のルール追加と同じ `createRuleAction` で、取り込み済みにもすぐ当て直す

## 決めたこと

- **提案は保存しない。** 画面を閉じると消え、見送った提案も押し直すと再び出ることがある。見送りを覚えるにはスキーマ変更が要るため、
  必要になったら別Issueで
- ボタンを押したときだけAPIを1回呼ぶ（自動では呼ばない）。使用量は `ledger-rule-suggest` として `AiUsageLog` に残る
- モデルは `ANTHROPIC_RULE_SUGGEST_MODEL`（未設定なら `claude-opus-5`）。APIキーは `ANTHROPIC_API_KEY`
- Jev（選択式のAI。`lib/typesafe-system-one.ts`）は含む文字を自分で書けないため、提案には使わない
- スキーマの制約（CLAUDE.md #397・#1041）に従い、null を許す id の enum は `anyOf` で書き、配列に `maxItems` を付けない。
  口座が1つも無いときは accountId を `null` だけにする（空の enum を作らない）。2026-11-07 に実APIへ投げて通ることを確かめた
