# ふるさと納税（明細ラボからの移管）

Issue #715 で、明細ラボ（`guchi-apps/meisai-lab`）のふるさと納税の寄付履歴・申請状況を
Asset Manager へ移した。移管元は meisai-lab の develop（受取予定期間 #267 / PR #268 を含む）。
統合全体の計画は親Issue #713、既存データの移行は #717（手順は `docs/meisai-lab-migration.md`）、年次税務は #716 で扱う。

## 画面

サイドバーの「給与」配下の共通タブ「ふるさと納税」から入る（`lib/nav-sections.ts` の `PAYROLL_TABS`）。

| URL | 内容 |
|---|---|
| `/furusato` | 年・状態で絞った一覧。年間寄付額・自治体数・ワンストップ未申請・証明書未取得のカード |
| `/furusato/new` | 寄付の登録 |
| `/furusato/[id]/edit` | 寄付の編集（ワンストップ・証明書の状態もここで切り替える） |

絞り込みはURLに載せる（`/furusato?year=2026&status=incomplete`）。`status` は `lib/furusato/filters.ts` の
キー（`incomplete`＝未申請または証明書未取得が残る、など）で、未知の値は「すべて」になる。
PC・iPadは表、スマホ（`md` 未満）はカードで表示する。

## 資産・Zaimとの関係

寄付は資産（`Asset`）・取引（`Transaction`）・Zaimとは**独立した記録**。寄付を登録・編集・削除しても
評価額・出金取引・Zaimの支出は作らないし、資産の画面の再検証もしない（`/furusato` だけ）。
寄付の支払いを資産やZaimへ反映するのは、これまでどおりZaimの自動取得か手入力で行う（二重計上を避けるため）。

## データの形（#717 の移行で崩さないこと）

モデルは `FurusatoDonation`。列名・値の語彙・id（cuid）は明細ラボと同じ。

- `oneStopStatus`: `notApplied` / `applied` / `accepted` / `switchedToTaxReturn`
- `certificateStatus`: `notReceived` / `received` / `notNeeded`
- `donatedAt`・`receiveFrom`・`receiveTo` は日付入力の値を **UTC の0時**として持つ（給与・賞与と同じ）。
  `year` は寄付日のUTCの年から導出し、クライアントからは受け取らない
- 受取予定は片方だけでも持てる。空にすれば解除。開始日が終了日より後なら保存せず理由を返す
- 削除は論理削除（`deletedAt`）。すべての読み書きを `userId` で絞り、他のユーザーの寄付は id を知っていても読めず、書き換えられない
- 「確定申告へ切替」なのに証明書が「不要（ワンストップ）」の組み合わせは保存しない

## 税務側（#716）との契約

年間の寄付額は **寄付明細の合計 ＋ 年次控除の調整額**。調整額は「明細に載せていない寄付」の補正で、
明細とは別の値として受け取る。

- 集計は `lib/furusato/summary.ts` の `summarizeDonations(donations, adjustment)`（純粋関数）。
  `effectiveTotal` が税務で使う額、`total` が明細合計、`adjustment` が調整額
- 読み出しは `lib/furusato/service.ts` の `getFurusatoYearTotal(userId, year, adjustment)` と
  `getFurusatoSummaries(userId, years, adjustments)`。キャッシュを持たないので、寄付の追加・編集・削除は
  次の呼び出しから反映される
- 年次控除（`Deduction` 相当）のモデルはまだ無い。#716 でそのモデルを作るときは、**ふるさと納税の控除額を
  税務の計算へ直接使わず**、必ず上の関数へ調整額として渡す（明細を数えたうえで同じ寄付を調整額にも入れると二重計上になる）

## ワンストップ特例の注意表示

その年に「確定申告へ切替」の寄付がある、または寄付先が6自治体以上（`ONE_STOP_MUNICIPALITY_LIMIT = 5`）のとき、
「確定申告をする場合、ワンストップ特例の申請はすべて無効になります」を出す（`FurusatoSummary.oneStopInvalidated`）。

## 移管しなかったもの

- 明細ラボの REST API（`/api/furusato-donations`）。画面はサーバーアクションのみ（`app/actions/furusato.ts`）
- 年次税務の画面・年次控除（#716）、既存本番データの移行（#717）
