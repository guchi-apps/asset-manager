/**
 * 取り込み元に依存しない明細の形（Issue #817）。
 *
 * 取り込み元ごとのアダプタ（`lib/ledger-sources/zaim/adapter.ts` など）がこの形へ変換し、
 * 家計簿への反映（`lib/ledger-sources/sync-*.ts`）はこの形だけを見る。将来取得元を変えるときは
 * アダプタを足すだけで済むようにする（#814の方針）。
 */

export type SourceEntryKind = "EXPENSE" | "INCOME" | "TRANSFER"

export interface SourceItemInput {
    name: string
    /** 円。値引きの行はマイナスになりうる */
    amount: number
    category: string | null
    genre: string | null
}

export interface SourceRecordInput {
    /** 取り込み元の明細id */
    externalId: string
    /** JSTの `YYYY-MM-DD` */
    date: string
    /** 円。支出・収入・振替とも正の数が基本で、返金はマイナスで来ることがある */
    amount: number
    kind: SourceEntryKind
    /** 取り込み元が種別を返さず、口座名の有無から推定したか */
    kindInferred: boolean
    fromName: string | null
    toName: string | null
    place: string | null
    /** 品目名（代表） */
    name: string | null
    memo: string | null
    category: string | null
    genre: string | null
    /** 商品別の内訳。取得できて合計も合っているときだけ入れる */
    items: SourceItemInput[] | null
    /** 内訳の取得状態（complete / partial / failed）。内訳を持たない明細は null */
    itemsStatus: string | null
    /** 取り込み元で「集計に含めない」になっているか。取り込み元が返さなければ null */
    excluded: boolean | null
    /**
     * Zaimの「集計の設定」の生の値（AIDEの `calcFlag`。guchi-apps/aide#759）。値の意味はCSVと突き合わせて
     * 確かめるまで `excluded` に変換しない。AIDEが返さなければキーごと無い（取り込み済みの明細のハッシュを変えない）
     */
    calcFlag?: number | null
}

export interface SourceSnapshot {
    provider: string
    /** 取り込み元が最後に取得した時刻（ISO8601）。一度も取得していなければ null */
    fetchedAt: string | null
    /** 取り込み元が古い（巡回が止まっている）か */
    stale: boolean
    /** 一度も取得していないか */
    empty: boolean
    /**
     * 全日を読めた暦月（`YYYYMM`）。この月の中で見当たらない明細だけを「見当たらない」にする。
     * 読めていない月を含めると、実際にはある明細を消えたと誤判定する
     */
    coveredMonths: string[]
    records: SourceRecordInput[]
    /** 明細idが読めず取り込めなかった件数 */
    skippedNoId: number
}
