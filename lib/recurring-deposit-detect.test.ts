import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
    assignDepositMonth,
    canRegisterMonthState,
    judgeToday,
    predictDepositDay,
    resolveTargetMonths,
    resolveDecisionAt,
    resolveMonthState,
    countDaysBetween,
    describeGap,
    isValidDayKey,
    rankDepositCandidates,
    buildDepositCandidates,
    detectDepositDay,
    resolveDepositWindow,
    resolveExpectedDayOfMonth,
    resolveTargetMonth,
    type ValuationPoint,
} from "./recurring-deposit-detect"

/** 33,000円の積立を、16日ごろに受けている資産の1ヶ月ぶん。 */
const AMOUNT = 33_000
const WINDOW = { windowFrom: "2026-09-09", windowTo: "2026-09-23" }

function points(entries: [string, number][]): ValuationPoint[] {
    return entries.map(([dayKey, value]) => ({ dayKey, value }))
}

describe("countDaysBetween", () => {
    it("counts calendar days across a month boundary", () => {
        assert.equal(countDaysBetween("2026-08-31", "2026-09-01"), 1)
        assert.equal(countDaysBetween("2026-09-09", "2026-09-09"), 0)
        assert.equal(countDaysBetween("2026-09-19", "2026-09-23"), 4)
    })
})

describe("resolveExpectedDayOfMonth", () => {
    it("keeps a day that exists in the month", () => {
        assert.equal(resolveExpectedDayOfMonth("2026-09", 16), "2026-09-16")
    })

    it("clamps to the last day when the month is shorter", () => {
        assert.equal(resolveExpectedDayOfMonth("2026-02", 31), "2026-02-28")
        assert.equal(resolveExpectedDayOfMonth("2026-09", 31), "2026-09-30")
    })

    it("clamps a nonsense day to the first", () => {
        assert.equal(resolveExpectedDayOfMonth("2026-09", 0), "2026-09-01")
    })
})

describe("resolveDepositWindow", () => {
    it("spans seven days either side of the expected day", () => {
        assert.deepEqual(resolveDepositWindow("2026-09", 16), {
            from: "2026-09-09",
            to: "2026-09-23",
        })
    })

    it("may cross into the neighbouring months", () => {
        assert.deepEqual(resolveDepositWindow("2026-09", 3), {
            from: "2026-08-27",
            to: "2026-09-10",
        })
        assert.deepEqual(resolveDepositWindow("2026-09", 28), {
            from: "2026-09-21",
            to: "2026-10-05",
        })
    })
})

describe("resolveTargetMonth", () => {
    it("waits until the window has closed before judging the month", () => {
        // 窓は 09-09〜09-23。まだ閉じていない日は前月が対象。
        assert.equal(resolveTargetMonth("2026-09-22", 16), "2026-08")
        assert.equal(resolveTargetMonth("2026-09-23", 16), "2026-09")
        assert.equal(resolveTargetMonth("2026-09-30", 16), "2026-09")
    })

    it("rolls back across the new year", () => {
        assert.equal(resolveTargetMonth("2026-01-05", 16), "2025-12")
    })
})

describe("detectDepositDay", () => {
    it("picks the day whose rise is closest to the deposit", () => {
        const result = detectDepositDay({
            amount: AMOUNT,
            ...WINDOW,
            points: points([
                ["2026-09-08", 3_140_000],
                ["2026-09-09", 3_149_000],
                ["2026-09-10", 3_167_000],
                ["2026-09-12", 3_172_000],
                ["2026-09-15", 3_182_400],
                ["2026-09-16", 3_215_880],
                ["2026-09-17", 3_208_880],
                ["2026-09-18", 3_220_680],
            ]),
        })

        assert.equal(result.detected, true)
        if (!result.detected) return
        assert.equal(result.candidate.dayKey, "2026-09-16")
        assert.equal(result.candidate.previousDayKey, "2026-09-15")
        assert.equal(result.candidate.gapDays, 1)
        assert.equal(Math.round(result.candidate.increase), 33_480)
        assert.equal(Math.round(result.candidate.difference), 480)
    })

    it("compares against the last record, not the previous calendar day", () => {
        // 13・14日（土日）に記録が無く、15日は12日から3日ぶり。
        const result = detectDepositDay({
            amount: AMOUNT,
            ...WINDOW,
            points: points([
                ["2026-09-12", 3_100_000],
                ["2026-09-15", 3_133_400],
            ]),
        })

        assert.equal(result.detected, true)
        if (!result.detected) return
        assert.equal(result.candidate.dayKey, "2026-09-15")
        assert.equal(result.candidate.gapDays, 3)
    })

    it("refuses a gap of four days or more even when the rise looks right", () => {
        const result = detectDepositDay({
            amount: AMOUNT,
            ...WINDOW,
            points: points([
                ["2026-09-19", 3_100_000],
                ["2026-09-23", 3_134_900],
            ]),
        })

        assert.equal(result.detected, false)
        if (result.detected) return
        assert.equal(result.reason, "notEnoughRecords")
        // 惜しい候補は「なぜ選べなかったか」を説明するために残す
        assert.equal(result.nearest?.dayKey, "2026-09-23")
        assert.equal(result.nearest?.gapDays, 4)
    })

    it("does not register when every day is far from the deposit", () => {
        const result = detectDepositDay({
            amount: AMOUNT,
            ...WINDOW,
            points: points([
                ["2026-09-15", 3_100_000],
                ["2026-09-16", 3_104_000],
                ["2026-09-17", 3_190_000],
            ]),
        })

        assert.equal(result.detected, false)
        if (result.detected) return
        assert.equal(result.reason, "noNearDay")
        assert.equal(result.nearest?.dayKey, "2026-09-16")
    })

    it("ignores rises that land outside the window", () => {
        const result = detectDepositDay({
            amount: AMOUNT,
            ...WINDOW,
            points: points([
                ["2026-09-07", 3_100_000],
                // 窓（09-09〜09-23）の外で終わる区間なので候補にしない
                ["2026-09-08", 3_133_000],
                ["2026-09-24", 3_166_000],
            ]),
        })

        assert.equal(result.detected, false)
        if (result.detected) return
        assert.equal(result.reason, "notEnoughRecords")
        assert.equal(result.nearest, null)
    })

    it("needs two records to compare", () => {
        const result = detectDepositDay({
            amount: AMOUNT,
            ...WINDOW,
            points: points([["2026-09-16", 3_215_880]]),
        })

        assert.equal(result.detected, false)
        if (result.detected) return
        assert.equal(result.reason, "notEnoughRecords")
    })

    it("prefers the earlier day when two days are equally close", () => {
        const result = detectDepositDay({
            amount: AMOUNT,
            ...WINDOW,
            points: points([
                ["2026-09-14", 3_000_000],
                ["2026-09-15", 3_033_000],
                ["2026-09-16", 3_066_000],
            ]),
        })

        assert.equal(result.detected, true)
        if (!result.detected) return
        assert.equal(result.candidate.dayKey, "2026-09-15")
    })

    it("sorts the records before comparing them", () => {
        const result = detectDepositDay({
            amount: AMOUNT,
            ...WINDOW,
            points: points([
                ["2026-09-16", 3_215_880],
                ["2026-09-15", 3_182_400],
            ]),
        })

        assert.equal(result.detected, true)
        if (!result.detected) return
        assert.equal(result.candidate.dayKey, "2026-09-16")
    })
})

describe("describeGap", () => {
    it("names the previous day without a count", () => {
        assert.equal(describeGap(1), "前日")
        assert.equal(describeGap(3), "3日前")
    })
})

describe("rankDepositCandidates", () => {
    const candidates = buildDepositCandidates({
        points: points([
            ["2026-09-14", 100_000],
            ["2026-09-15", 100_500],
            ["2026-09-16", 133_000],
            ["2026-09-17", 133_200],
            ["2026-09-18", 150_000],
        ]),
        amount: AMOUNT,
        ...WINDOW,
    })

    it("orders by closeness to the amount and cuts to the limit", () => {
        const ranked = rankDepositCandidates(candidates, 2)
        assert.deepEqual(
            ranked.map((candidate) => candidate.dayKey),
            ["2026-09-16", "2026-09-18"]
        )
    })

    it("keeps candidates across long gaps for a human to judge", () => {
        const gapped = buildDepositCandidates({
            points: points([
                ["2026-09-10", 100_000],
                ["2026-09-20", 133_000],
            ]),
            amount: AMOUNT,
            ...WINDOW,
        })
        assert.equal(rankDepositCandidates(gapped).length, 1)
    })
})

describe("isValidDayKey", () => {
    it("accepts real days only", () => {
        assert.equal(isValidDayKey("2026-09-16"), true)
        assert.equal(isValidDayKey("2026-02-30"), false)
        assert.equal(isValidDayKey("2026-9-16"), false)
        assert.equal(isValidDayKey("garbage"), false)
    })
})

describe("積立の対象月ごとの状態（#696）", () => {
    const base = {
        thisMonth: "2026-10",
        todayKey: "2026-10-11",
        enabled: true,
        createdDayKey: "2026-01-01",
        record: null,
        liveDeposit: null,
    }

    it("月をまたぐ窓の入金は予定日の月に属し、隣の月へ誤って付かない", () => {
        // 10/28予定の窓は 10/21〜11/04
        assert.equal(assignDepositMonth("2026-11-02", 28), "2026-10")
        assert.equal(assignDepositMonth("2026-11-05", 28), "2026-11")
        // 年またぎ: 12/28予定の入金が1/3なら12月分
        assert.equal(assignDepositMonth("2027-01-03", 28), "2026-12")
        assert.equal(assignDepositMonth("2027-01-06", 28), "2027-01")
        assert.equal(resolveDecisionAt(resolveDepositWindow("2026-10", 28)), "2026-11-04 23:55")
    })

    it("閲覧だけでは判定待ち・予定・未実施を区別する", () => {
        assert.equal(
            resolveMonthState({ ...base, month: "2026-10", windowTo: "2026-10-15" }).state,
            "pending"
        )
        assert.equal(
            resolveMonthState({ ...base, month: "2026-11", windowTo: "2026-11-12" }).state,
            "upcoming"
        )
        assert.equal(
            resolveMonthState({ ...base, month: "2026-09", windowTo: "2026-09-22" }).state,
            "notRun"
        )
        assert.equal(
            resolveMonthState({ ...base, createdDayKey: "2026-10-01", month: "2026-08", windowTo: "2026-08-22" })
                .state,
            "noHistory"
        )
    })

    it("未検出でも実在する手入力の入金があれば手動登録済みとして紐づけ可能にする", () => {
        const result = resolveMonthState({
            ...base,
            month: "2026-09",
            windowTo: "2026-09-22",
            record: { status: "UNDETECTED", method: null, transactionLive: false },
            liveDeposit: { method: "MANUAL" },
        })
        assert.deepEqual(result, { state: "manualRegistered", needsLink: true })
    })

    it("登録方法が分からない登録済みは推測せず登録方法不明にする", () => {
        const result = resolveMonthState({
            ...base,
            month: "2026-09",
            windowTo: "2026-09-22",
            record: { status: "REGISTERED", method: null, transactionLive: true },
            liveDeposit: { method: "MANUAL" },
        })
        assert.deepEqual(result, { state: "registeredUnknown", needsLink: false })
    })
})

describe("resolveTargetMonths（毎日判定・#1322）", () => {
    it("窓の途中の月は open、閉じた最新の月は closed で返す", () => {
        // 予定日16日 → 窓は 09-09〜09-23。
        assert.deepEqual(resolveTargetMonths("2026-09-15", 16), [
            { month: "2026-08", phase: "closed" },
            { month: "2026-09", phase: "open" },
        ])
        assert.deepEqual(resolveTargetMonths("2026-09-23", 16), [{ month: "2026-09", phase: "closed" }])
    })

    it("窓が前月からはじまる設定（予定日3日）でも、今日を含む月を open にする", () => {
        // 窓は 10-27〜11-10（対象月は11月）。10/28 は前月の中だが11月の窓の内側。
        assert.deepEqual(resolveTargetMonths("2026-10-28", 3), [
            { month: "2026-10", phase: "closed" },
            { month: "2026-11", phase: "open" },
        ])
    })

    it("窓が翌月へかかる設定（予定日28日）は、窓が閉じるまで closed にしない", () => {
        // 10月分の窓は 10-21〜11-04。11/02 はまだ open（閉じた最新の月は9月）。
        assert.deepEqual(resolveTargetMonths("2026-11-02", 28), [
            { month: "2026-09", phase: "closed" },
            { month: "2026-10", phase: "open" },
        ])
        assert.deepEqual(resolveTargetMonths("2026-11-04", 28), [{ month: "2026-10", phase: "closed" }])
    })
})

describe("predictDepositDay", () => {
    it("実績が無ければ予定日", () => {
        assert.equal(predictDepositDay("2026-11", 10, []), "2026-11-10")
    })

    it("過去のずれの中央値を予定日へ足す", () => {
        const history = [
            { month: "2026-10", detectedDay: "2026-10-12" },
            { month: "2026-09", detectedDay: "2026-09-12" },
            { month: "2026-08", detectedDay: "2026-08-10" },
        ]
        assert.equal(predictDepositDay("2026-11", 10, history), "2026-11-12")
    })
})

describe("judgeToday", () => {
    const points = [
        { dayKey: "2026-11-09", value: 1_000_000 },
        { dayKey: "2026-11-10", value: 1_100_000 },
    ]

    it("増え方・間隔・予測日が揃えば入金日", () => {
        const result = judgeToday({ points, amount: 100_000, todayKey: "2026-11-10", predictedDay: "2026-11-11" })
        assert.equal(result.isDepositDay, true)
    })

    it("増え方が入金額から離れていれば入金日ではない", () => {
        const result = judgeToday({ points, amount: 50_000, todayKey: "2026-11-10", predictedDay: "2026-11-10" })
        assert.equal(result.isDepositDay, false)
    })

    it("予測日から4日以上離れていれば、増え方が合っていても保留する", () => {
        const result = judgeToday({ points, amount: 100_000, todayKey: "2026-11-10", predictedDay: "2026-11-20" })
        assert.equal(result.isDepositDay, false)
    })

    it("今日の記録が無ければ入金日ではない", () => {
        const result = judgeToday({ points, amount: 100_000, todayKey: "2026-11-11", predictedDay: "2026-11-11" })
        assert.deepEqual(result, { isDepositDay: false, candidate: null })
    })
})

describe("canRegisterMonthState（#1358）", () => {
    it("判定待ち・未実施・未検出・失敗は、今月までなら日付を選んで登録できる", () => {
        for (const state of ["pending", "notRun", "undetected", "failed"] as const) {
            assert.equal(canRegisterMonthState(state, "2026-11", "2026-11"), true)
            assert.equal(canRegisterMonthState(state, "2026-10", "2026-11"), true)
        }
    })

    it("来月以降は、状態によらず登録できない", () => {
        assert.equal(canRegisterMonthState("pending", "2026-12", "2026-11"), false)
        assert.equal(canRegisterMonthState("upcoming", "2026-12", "2026-11"), false)
    })

    it("登録済み・停止中・履歴なし・予定は登録できない", () => {
        for (const state of [
            "autoRegistered",
            "manualRegistered",
            "registeredUnknown",
            "disabled",
            "noHistory",
            "upcoming",
        ] as const) {
            assert.equal(canRegisterMonthState(state, "2026-11", "2026-11"), false)
        }
    })
})
