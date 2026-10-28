# Zaim公式APIの終了への対応（Issue #788）

Zaim公式API（`api.zaim.net/v2`、OAuth 1.0a）は **2026-12-07 中に全エンドポイントが順次停止**し、後継APIは
提供されない。API経由で取得・保存したデータと認証情報は、終了後すみやかに、遅くとも **2027-01-07** までに
削除が求められている（公式告知: https://content.zaim.net/notices/show/2280 ）。

Asset Manager は #788 で公式APIの呼び出しをすべて撤去した。AIDE側の対応は guchi-apps/aide#714
（AIDEの公式API経路は「明示エラーで廃止」と決まり、Web画面からマスタを取る経路は作らない）。

**この文書に実値（キー・トークン・個別の家計データ）を書かない。**

## 機能ごとの判断

撤去前の呼び出し元と、#788 での扱い。「本番稼働」は撤去時点の画面・定期実行からの到達性。

| 機能 | 使っていたAPI | 呼び出し元 | 本番稼働 | 保存先 | #788 の判断 |
|---|---|---|---|---|---|
| マスタの取り込み | `GET /home/category`・`/home/genre`・`/home/account` | `syncZaimMasters`（`syncZaimMastersAction`） | 画面の入口は既に無し | `ZaimGenre`・`ZaimAccount` | **撤去**。取り込み済みの行を凍結して使い続ける |
| 連携明細の取り込み（詳細明細を探す） | `GET /home/money` ＋ AIDEのWeb版一覧 | `importLinkedReceipts`（`searchCardReceiptDetails`） | 画面から稼働 | `ReceiptImport`・`ReceiptItem` | **Web版一覧だけへ移行**。読めなければ中止し、APIへ戻らない |
| 重複の可能性（Zaim明細との照合） | `GET /home/money` | `lookupReceiptDuplicates` | 画面から稼働 | 保存しない | **停止**。取り込み同士の照合だけ残す（下記） |
| 内訳の提案（読み込み・反映） | `GET /home/money`・`PUT /home/money/payment/:id` | `refreshGenreSuggestions`・`applyGenreSuggestions` | 入口は #628 で削除済み | `ZaimGenreSuggestion` | **撤去** |
| 口座間コピー（プレビュー・実行） | `GET /home/money`・`POST /home/money/payment` | `previewCopyTargets`・`runCopyRules` | 入口は #628 で削除済み | `ZaimCopiedEntry` | **撤去** |
| OAuthの認可・口座一覧 | `/v2/auth/*`・`GET /home/account` | `scripts/zaim-oauth.ts` | 手動のみ | `.env` へ手で貼る | **撤去** |
| 置き換えの検証 | `GET`/`POST`/`DELETE /home/money` | `scripts/zaim-replace-probe.ts` | 手動のみ | 保存しない | **撤去** |

定期実行（`ecosystem.config.js` のPM2ジョブ）は、どれも公式APIを呼んでいなかった（評価額の
`asset-manager-zaim-sync` はAIDEの巡回キャッシュを読む）。

**維持したもの**: 通常のレシート登録（AIDEのWeb版入力。#302）・カード明細の置き換え・car-care等からの取り込み
（`lib/payment-import.ts`）・評価額のAIDE巡回キャッシュ経路・Web版の内訳／メモの書き換え。

### 重複照合を Web版一覧へ移さなかった理由

公式APIの `GET /home/money` は手入力と置き換え済みの明細しか返さず、置き換え前のカード連携明細は
返さなかった。重複照合はこの性質に頼っていた。AIDEのWeb版一覧には「自動連携か手入力か」を示す項目が無く
（aide `src/core/connectors/zaim/types.ts` の `ZaimRawMoneyEntry`）、使うと置き換える相手（#443）まで
「重複の可能性」に出てしまう。誤った印を出すより、照合しないことを画面に出すほうを選んだ。

### 内訳の提案・口座間コピーを移行しなかった理由

#788 の計画時点では「Web版登録へ移行」と回答を得たが、実装中に **#628（2026-10-03）で画面の入口が
すでに削除されていた**ことが分かり、改めて確認して撤去に変えた。ルール（`ZaimCopyRule`）と保存済みの
提案は残っているので、画面を戻すときはWeb版経路（`registerZaimWebPayment`・`updateZaimWebGenre`）で作り直す。

## API由来の保存データ

削除・保持の判断と実施は、本人確認を経て #794 で行う（#788 では消さない）。

| 保存先 | API由来の内容 | Web・利用者入力由来の内容 | 見分け方 |
|---|---|---|---|
| `ZaimGenre` | カテゴリ・内訳のid・名前・並び順・有効フラグ（全行） | `hidden`（利用者が隠した印） | 行単位では全行API由来 |
| `ZaimAccount` | 口座のid・名前・有効フラグ（全行） | `kind`・`kindManual`（推定・利用者の選択） | 行単位では全行API由来 |
| `ZaimGenreSuggestion` | `origin = API` の行（明細の日付・金額・品目・お店） | `origin = WEB` の行 | `origin` 列 |
| `ZaimCopiedEntry` | `copiedMoneyId`（APIの登録応答）と、APIで読んだ複製元 | — | 全行API由来 |
| `ZaimCopyRule` | 口座id（マスタ由来） | ルールの設定そのもの | 利用者入力として扱える |
| `ReceiptImport`・`ReceiptItem`（連携明細の取り込み） | #788 以前に `GET /home/money` から取り込んだ行 | Web版一覧から取り込んだ行・写真・Gmail・car-care | **行に読み込み元が残っていない**。Amazon由来はAPI経由の可能性が高く、スマートレシート由来は #379 以降Web版のみ |
| `ExternalPaymentImport`（`source = zaim-linked-deleted`） | 削除した連携明細のmoney id | — | 読み込み元は残っていない |

`ZaimGenre`・`ZaimAccount` はレシート登録・取り込み・サブスクの口座紐づけの選択肢で、消すとこれらが
使えなくなる。**一括で消さず、削除するなら代わりの入手手段（Web画面から読む・手で登録する）と一緒に決める。**

## 認証情報

| 置き場 | 内容 | 状態 |
|---|---|---|
| 本番VPSの `.env` | `ZAIM_CONSUMER_KEY`・`ZAIM_CONSUMER_SECRET`・`ZAIM_ACCESS_TOKEN`・`ZAIM_ACCESS_TOKEN_SECRET`（・`ZAIM_OAUTH_CALLBACK_URL`） | GitHub Secretsでは配っておらず、VPSへ直接置く運用だった（`docs/receipt-import.md`）。app-deploy-gate は `.env` のキーを消せないため、**VPSで手作業で消す**。#788 の作業中は本番の読み取り権限が無く、有無を確認していない |
| サブPCの `.env.local` | 同上 | 開発用。手で消す |
| 1Password | 同上が登録されているか未確認 | 確認して削除 |
| Zaim開発者サイト | アプリ登録（コンシューマキー） | 連携の解除・アプリ削除を検討 |
| DBバックアップ | 上表のAPI由来データを含む | 保管先・保持期間を確認する |

コードは上記の値を一切読まなくなった（`ZAIM_CARD_ACCOUNT_ID`・`ZAIM_PENDING_ACCOUNT_ID`・
`ZAIM_SMART_RECEIPT_ACCOUNT_ID`・`ZAIM_AMAZON_ACCOUNT_ID` はAPIの認証情報ではなく、Web版登録でも使う口座の指定）。

## 残る作業

- API由来データ・認証情報の削除／保持の判断と実施（期限 2027-01-07。本人確認つき）: #794
- カテゴリ・内訳・口座のマスタを公式API以外から入手するか（AIDE側の要否判断を含む）: #795
