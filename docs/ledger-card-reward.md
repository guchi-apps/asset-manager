# カード特典の利用額の集計（Issue #1532）

三井住友カードの「年間100万円の利用で10,000ポイント」のように、**年間の利用額で特典がもらえるカード**の利用額を、
カードの口座ごとに把握する。表示は家計簿の口座の画面（口座タブのカード・口座の詳細画面）。

## 持ち方

- `LedgerAccount.rewardEnabled` / `rewardStartMonth`（年度の起点月 1〜12）/ `rewardTarget`（目標額。既定100万円）。`kind = CARD` の口座だけが持てる（`lib/ledger-input.ts` の `parseAccountInput` が、カード以外は false に固定する）
- `LedgerEntry.rewardOverrideNote`（`String?`、100字まで。#1544）。手動で対象外にした理由。`rewardOverride = false` のときだけ持ち、対象・自動に戻すと null になる
- `LedgerEntry.rewardOverride`（`Boolean?`）。true=対象・false=対象外・null=自動判定。**`excludeFromTotals`（家計簿の「集計に含めない」）とは別**で、特典の集計だけに効く。判定でも `excludeFromTotals` は見ない（カード会社の累計は家計簿の集計除外と無関係なため）

## 操作と表示（#1544）

- 切り替えは取引の編集ダイアログの「詳細な設定」の「カード特典」（自動／対象にする／対象外にする、対象外のときは理由）。特典の集計をしているカードで払った、確定した支出にだけ出る。保存は取引の更新（`parseEntryInput` の `rewardOverride`・`rewardOverrideNote`）で、キーが送られなければ保存済みの値を残す
- 口座の履歴一覧は、**対象外の取引にだけ**「特典の対象外（理由）」を出す。括弧は手動なら入力した理由（未入力は「手動」）、自動なら「自動: キーワード」。対象の取引には何も出さない

## 集計のルール（`lib/card-reward.ts`）

- 期間: 起点月の1日から12か月（暦年ではない）。例: 7月起点なら 7/1〜翌6/30。`rewardPeriod`
- 数える取引: その口座で**確定した（`CONFIRMED`）支出**。反映待ち（`PENDING_STATEMENT`）・照合待ち（`MATCH_PENDING`）は含めない。支払いを分けた取引はその口座が払った分だけ（`paidByAccount`）。返金（マイナスの支出）は引く
- 対象外の自動判定: 店名・品目・カテゴリ名がキーワード表（`REWARD_EXCLUSION_RULES`）に当たると対象外。表はテスト（`lib/card-reward.test.ts`）で固定
- 優先順: `rewardOverride`（手動）→ キーワード（自動）→ 対象

## 公式の条件（2026-11-21 時点。三井住友カード ゴールド(NL) の特典ページ・FAQ）

- 対象外: 年会費（カード・ETC・PiTaPa）、つみたて投資・外貨自動積立、キャッシング・ローン返済、リボ・分割の手数料、マイレージ移行手数料、国民年金保険料、PiTaPa、電子マネー・プリペイドへのチャージ（交通系・nanaco・WAON・楽天Edy・au PAY・Kyash・バンドルカード・ANA Pay・JAL Pay・VポイントPay・三井住友発行のプリペイド）
- 対象: 税金・家賃・公共料金、Amazonギフト券、保険料、家族カードの利用、リボ・分割払いの利用分
- **Google Pay経由のモバイルSuicaのチャージ・定期券は公式では「対象」**だが、文言だけでは見分けられない。「チャージ」「Suica」は自動で対象外にするので、該当する取引は手で「特典の対象にする」
- 売上票の到着が期間後にずれた分は公式の累計に入らない。画面には「正しい累計はVpassアプリ」と案内している
- 対象外の一覧は変わりうる。カード種別（ゴールド(NL)以外）で条件が違う場合も手動の上書きで吸収する（表の切り替えはしない）
- VISAとMastercardなど複数枚の合算可否は公式に記載が無いため、カード（口座）ごとに別集計

## 取引の統合で上書きを落とさない

- 反映待ち ↔ カード明細のまとめ（`resolveMatchPending`・`absorbPendingIntoStatement`、`lib/ledger-receipt-service.ts`）: 残す側が null のときだけ、消す側の値（と理由）を引き継ぐ（`rewardOverrideCarryOver`）
- 収入・支出 → 振替の統合（`mergeEntriesToTransfer`）: 支出でなくなるので上書きも理由も null に戻す
