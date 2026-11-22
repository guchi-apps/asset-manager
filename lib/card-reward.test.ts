import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
    computeRewardProgress,
    isRewardCounted,
    parseRewardSnapshotInput,
    rewardElapsed,
    rewardAutoExclusionReason,
    rewardExclusionReason,
    rewardPeriod,
    type RewardEntry,
} from "@/lib/card-reward"

describe("rewardPeriod（カード年度。Issue #1532）", () => {
    it("起点月の1日から12か月。今日が起点月以降なら同じ年から始まる", () => {
        assert.deepEqual(rewardPeriod(7, "2026-11-21"), { start: "2026-07-01", end: "2027-06-30" })
        assert.deepEqual(rewardPeriod(7, "2026-07-01"), { start: "2026-07-01", end: "2027-06-30" })
    })
    it("今日が起点月より前なら前の年から始まる", () => {
        assert.deepEqual(rewardPeriod(7, "2026-06-30"), { start: "2025-07-01", end: "2026-06-30" })
        assert.deepEqual(rewardPeriod(7, "2026-03-05"), { start: "2025-07-01", end: "2026-06-30" })
    })
    it("起点月が1月なら暦年と同じ", () => {
        assert.deepEqual(rewardPeriod(1, "2026-11-21"), { start: "2026-01-01", end: "2026-12-31" })
    })
    it("終わりの月の末日はうるう年を見る（起点月3月 → 翌年2月末）", () => {
        assert.deepEqual(rewardPeriod(3, "2027-05-01"), { start: "2027-03-01", end: "2028-02-29" })
        assert.deepEqual(rewardPeriod(3, "2026-05-01"), { start: "2026-03-01", end: "2027-02-28" })
    })
    it("起点月が12月なら11月末まで", () => {
        assert.deepEqual(rewardPeriod(12, "2026-11-21"), { start: "2025-12-01", end: "2026-11-30" })
    })
})

describe("rewardExclusionReason（対象外のキーワード表。公式の条件に合わせて固定）", () => {
    const excluded: [string, string][] = [
        ["年会費（ゴールド）", "年会費"],
        ["ETC年会費", "年会費"],
        ["三井住友カード つみたて投資", "つみたて投資・外貨自動積立"],
        ["外貨自動積立", "つみたて投資・外貨自動積立"],
        ["キャッシング利用", "キャッシング・ローン返済"],
        ["リボ手数料", "リボ・分割の手数料"],
        ["分割手数料", "リボ・分割の手数料"],
        ["マイレージ移行手数料", "マイレージ移行手数料"],
        ["国民年金保険料", "国民年金保険料"],
        ["PiTaPa ご利用分", "PiTaPa"],
        ["nanacoチャージ", "電子マネー・プリペイドへのチャージ"],
        ["ＷＡＯＮ チャージ", "電子マネー・プリペイドへのチャージ"],
        ["楽天Edy", "電子マネー・プリペイドへのチャージ"],
        ["Suicaチャージ", "電子マネー・プリペイドへのチャージ"],
        ["PASMO", "電子マネー・プリペイドへのチャージ"],
        ["ICOCA", "電子マネー・プリペイドへのチャージ"],
        ["au PAY チャージ", "電子マネー・プリペイドへのチャージ"],
        ["Kyash", "電子マネー・プリペイドへのチャージ"],
        ["バンドルカード", "電子マネー・プリペイドへのチャージ"],
        ["ANA Pay", "電子マネー・プリペイドへのチャージ"],
        ["JAL Pay", "電子マネー・プリペイドへのチャージ"],
        ["VポイントPay", "電子マネー・プリペイドへのチャージ"],
        ["三井住友プリペイド", "電子マネー・プリペイドへのチャージ"],
    ]
    for (const [text, reason] of excluded) {
        it(`「${text}」→ ${reason}`, () => assert.equal(rewardExclusionReason([text]), reason))
    }

    const counted = ["東京電力", "固定資産税", "家賃", "Amazonギフト券", "生命保険料", "セブン-イレブン", "Kennedy Coffee", "スイカ（果物）", "キャッシュバック"]
    for (const text of counted) {
        it(`「${text}」は対象`, () => assert.equal(rewardExclusionReason([text]), null))
    }

    it("店名・品目・カテゴリのどれかに当たれば対象外", () => {
        assert.equal(rewardAutoExclusionReason({ kind: "EXPENSE", place: "セブン銀行", lines: [{ name: "nanaco", categoryLabel: null }] }), "電子マネー・プリペイドへのチャージ")
        assert.equal(rewardAutoExclusionReason({ kind: "EXPENSE", place: "鉄道", lines: [{ name: "運賃", categoryLabel: "交通 / Suica" }] }), "電子マネー・プリペイドへのチャージ")
    })
    it("収入は自動判定しない", () => {
        assert.equal(rewardAutoExclusionReason({ kind: "INCOME", place: "nanaco", lines: [] }), null)
    })
    it("カードから出る振替は、証券口座宛てだけ対象外・ETC利用は対象（#1559）", () => {
        assert.equal(rewardAutoExclusionReason({ kind: "TRANSFER", place: null, lines: [], toAccount: { name: "SBI証券", kind: "SECURITIES" } }), "証券口座への入金")
        assert.equal(rewardAutoExclusionReason({ kind: "TRANSFER", place: null, lines: [], toAccount: { name: "ETC 利用", kind: "OTHER" } }), null)
        assert.equal(rewardAutoExclusionReason({ kind: "TRANSFER", place: null, lines: [], toAccount: { name: "nanaco", kind: "EMONEY" } }), "電子マネー・プリペイドへのチャージ")
    })
})

describe("isRewardCounted（手動の上書きが自動判定より優先）", () => {
    it("上書きが無ければ自動判定に従う", () => {
        assert.equal(isRewardCounted({ rewardOverride: null, autoReason: null }), true)
        assert.equal(isRewardCounted({ rewardOverride: null, autoReason: "年会費" }), false)
    })
    it("対象にすると、自動で対象外でも数える", () => assert.equal(isRewardCounted({ rewardOverride: true, autoReason: "年会費" }), true))
    it("対象外にすると、自動で対象でも数えない", () => assert.equal(isRewardCounted({ rewardOverride: false, autoReason: null }), false))
})

describe("computeRewardProgress", () => {
    const entry = (id: number, date: string, amount: number, extra: Partial<RewardEntry> = {}): RewardEntry => ({
        id,
        kind: "EXPENSE",
        status: "CONFIRMED",
        date,
        amount,
        fromAccountId: 1,
        rewardOverride: null,
        autoReason: null,
        ...extra,
    })
    const settings = { startMonth: 7, target: 1_000_000 }
    const today = "2026-11-21"

    it("年度内の確定した支出を数え、対象外は別に集める", () => {
        const p = computeRewardProgress(
            1,
            [entry(1, "2026-07-01", 600_000), entry(2, "2026-10-01", 12_000), entry(3, "2026-11-15", 30_000, { autoReason: "電子マネー・プリペイドへのチャージ" })],
            settings,
            today
        )
        assert.equal(p.start, "2026-07-01")
        assert.equal(p.end, "2027-06-30")
        assert.equal(p.used, 612_000)
        assert.equal(p.remaining, 388_000)
        assert.equal(p.percent, 61)
        assert.equal(p.excluded, 30_000)
        assert.equal(p.countedCount, 2)
        assert.equal(p.excludedCount, 1)
    })
    it("年度の外・反映待ち・照合待ち・ほかの口座・収入は数えない", () => {
        const p = computeRewardProgress(
            1,
            [
                entry(1, "2026-06-30", 100),
                entry(2, "2027-07-01", 100),
                entry(3, "2026-08-01", 100, { status: "PENDING_STATEMENT" }),
                entry(4, "2026-08-01", 100, { status: "MATCH_PENDING" }),
                entry(5, "2026-08-01", 100, { fromAccountId: 2 }),
                entry(6, "2026-08-01", 100, { kind: "INCOME" }),
            ],
            settings,
            today
        )
        assert.equal(p.used, 0)
        assert.equal(p.excluded, 0)
    })
    it("カードから出る振替も数える。証券口座宛てなど対象外のものは除く（#1559）", () => {
        const p = computeRewardProgress(
            1,
            [
                entry(1, "2026-08-01", 610, { kind: "TRANSFER", autoReason: null }),
                entry(2, "2026-08-02", 100000, { kind: "TRANSFER", autoReason: "証券口座への入金" }),
            ],
            settings,
            today
        )
        assert.equal(p.used, 610)
        assert.equal(p.excluded, 100000)
    })
    it("支払いを分けた取引は、その口座が払った分だけを数える", () => {
        const p = computeRewardProgress(
            1,
            [entry(1, "2026-08-01", 5000, { payments: [{ accountId: 1, amount: 3000 }, { accountId: 9, amount: 2000 }] })],
            settings,
            today
        )
        assert.equal(p.used, 3000)
    })
    it("返金（マイナスの支出）は利用額から引く", () => {
        const p = computeRewardProgress(1, [entry(1, "2026-08-01", 10_000), entry(2, "2026-08-02", -3000)], settings, today)
        assert.equal(p.used, 7000)
    })
    it("手動の上書きで対象・対象外が入れ替わる", () => {
        const p = computeRewardProgress(
            1,
            [entry(1, "2026-08-01", 5500, { autoReason: "年会費", rewardOverride: true }), entry(2, "2026-08-02", 8000, { rewardOverride: false })],
            settings,
            today
        )
        assert.equal(p.used, 5500)
        assert.equal(p.excluded, 8000)
    })
    it("目標を超えたら残りは0・達成率は100で止める", () => {
        const p = computeRewardProgress(1, [entry(1, "2026-08-01", 1_200_000)], settings, today)
        assert.equal(p.remaining, 0)
        assert.equal(p.percent, 100)
    })
    it("起点月を変えると期間と集計が変わる", () => {
        const entries = [entry(1, "2026-02-01", 10_000), entry(2, "2026-08-01", 20_000)]
        assert.equal(computeRewardProgress(1, entries, { startMonth: 7, target: 1_000_000 }, today).used, 20_000)
        assert.equal(computeRewardProgress(1, entries, { startMonth: 1, target: 1_000_000 }, today).used, 30_000)
    })
})

describe("Vpassの値での補正とペース（Issue #1560）", () => {
    const entry = (id: number, date: string, amount: number, extra: Partial<RewardEntry> = {}): RewardEntry => ({
        id,
        kind: "EXPENSE",
        status: "CONFIRMED",
        date,
        amount,
        fromAccountId: 1,
        rewardOverride: null,
        autoReason: null,
        ...extra,
    })
    // 年度 2026-04-01〜2027-03-31（365日）
    const settings = { startMonth: 4, target: 1_000_000 }
    const today = "2026-11-23"
    const entries = [entry(1, "2026-05-01", 500_000), entry(2, "2026-11-20", 100_000), entry(3, "2026-11-21", 20_000), entry(4, "2026-11-22", 2_000)]

    it("Vpassの値が無ければ家計簿の記録だけで数える", () => {
        const p = computeRewardProgress(1, entries, settings, today)
        assert.equal(p.used, 622_000)
        assert.equal(p.base, null)
        assert.deepEqual(p.snapshots, [])
    })

    it("直近のVpassの値 ＋ その日より後の記録で数え、その日までは記録を見ない", () => {
        const p = computeRewardProgress(1, entries, settings, today, [
            { id: 1, date: "2026-10-15", amount: 480_000 },
            { id: 2, date: "2026-11-20", amount: 612_300 },
        ])
        assert.deepEqual(p.base, { date: "2026-11-20", amount: 612_300, after: 22_000 })
        assert.equal(p.used, 634_300)
        assert.equal(p.remaining, 365_700)
        // 新しい日付から並び、同じ日付までの記録との差を持つ
        assert.deepEqual(
            p.snapshots.map((s) => [s.date, s.appUsed, s.diff]),
            [
                ["2026-11-20", 600_000, 12_300],
                ["2026-10-15", 500_000, -20_000],
            ]
        )
    })

    it("年度外・未来の日付のVpassの値は基準にしない", () => {
        const p = computeRewardProgress(1, entries, settings, today, [
            { id: 1, date: "2026-03-31", amount: 900_000 },
            { id: 2, date: "2026-12-01", amount: 900_000 },
        ])
        assert.equal(p.base, null)
        assert.equal(p.used, 622_000)
        // 年度外の値は一覧にも出さない（未来の日付は年度内なので出る）
        assert.deepEqual(p.snapshots.map((s) => s.date), ["2026-12-01"])
    })

    it("期間の経過・目安・ペース差・年度末の見込み", () => {
        assert.deepEqual(rewardElapsed({ start: "2026-04-01", end: "2027-03-31" }, today), { totalDays: 365, elapsedDays: 237 })
        const p = computeRewardProgress(1, [entry(1, "2026-05-01", 834_501)], settings, today)
        assert.equal(p.elapsedPercent, 65)
        assert.equal(p.expected, 649_315)
        assert.equal(p.paceDiff, 834_501 - 649_315)
        assert.equal(p.projected, Math.round((834_501 * 365) / 237))
        assert.equal(p.requiredPer30Days, Math.ceil((165_499 * 30) / 128))
    })

    it("年度の初日は1日経過、末日は全日経過。達成済みなら必要額は出さない", () => {
        assert.equal(rewardElapsed({ start: "2026-04-01", end: "2027-03-31" }, "2026-04-01").elapsedDays, 1)
        assert.equal(rewardElapsed({ start: "2026-04-01", end: "2027-03-31" }, "2027-03-31").elapsedDays, 365)
        const p = computeRewardProgress(1, [entry(1, "2026-05-01", 1_200_000)], settings, today)
        assert.equal(p.requiredPer30Days, null)
        assert.equal(p.remaining, 0)
    })
})

describe("parseRewardSnapshotInput（Issue #1560）", () => {
    const today = "2026-11-23"
    it("日付と金額を読む。カンマ・円記号・全角は許す", () => {
        assert.deepEqual(parseRewardSnapshotInput({ date: "2026-11-20", amount: "８１２,３００円" }, today), {
            ok: true,
            value: { date: "2026-11-20", amount: 812_300 },
        })
        assert.deepEqual(parseRewardSnapshotInput({ date: "2026-11-23", amount: "0" }, today), { ok: true, value: { date: "2026-11-23", amount: 0 } })
    })
    it("未来・実在しない日付、負数・小数・空は弾く", () => {
        assert.equal(parseRewardSnapshotInput({ date: "2026-11-24", amount: "1" }, today).ok, false)
        assert.equal(parseRewardSnapshotInput({ date: "2026-02-30", amount: "1" }, today).ok, false)
        assert.equal(parseRewardSnapshotInput({ date: "", amount: "1" }, today).ok, false)
        assert.equal(parseRewardSnapshotInput({ date: "2026-11-20", amount: "-1" }, today).ok, false)
        assert.equal(parseRewardSnapshotInput({ date: "2026-11-20", amount: "1.5" }, today).ok, false)
        assert.equal(parseRewardSnapshotInput({ date: "2026-11-20", amount: "" }, today).ok, false)
        assert.equal(parseRewardSnapshotInput({ date: "2026-11-20", amount: "100000001" }, today).ok, false)
    })
})
