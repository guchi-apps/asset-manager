/**
 * Zaimの口座・Web版一覧の行を扱う共通の小道具（Issue #443 で置き換え候補の検索のために作った）。
 *
 * Zaimへの登録・置き換え（旧運用）は Issue #823 で廃止し、置き換える相手を探す `findReplaceTargets`・
 * 購入日を合わせる `pickAlignedPurchaseDate` は削除した。「反映待ち」口座の見分け（`isPendingAccount`）と、
 * 取り込み明細の整理（「Zaimと照合」）が使っていた月の範囲・口座の種別の型は #843 で削除した。
 * ここに残るのは、カード明細との対応付け・重複の判定がいまも使う定数だけ（口座名の比較キー `accountKey` も #843 で不要になった）。
 */

/** 購入日の前後何日までを候補にするか。カードの利用日と購入日は数日ずれることがある。 */
export const REPLACE_TARGET_WINDOW_DAYS = 3

/** 当アプリがWeb版へ登録した行に付けていたコメントの先頭（旧運用の `sendReceiptToZaim`）。候補から外す。 */
export const OWN_REGISTRATION_COMMENT_PREFIX = "Asset Manager レシート取込 #"
