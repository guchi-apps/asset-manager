import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
    clampToLastDayOfMonth,
    convertToJpy,
    daysBetween,
    formatBillingDay,
    formatDayKeyJa,
    getContractStatus,
    getContractStatusLabel,
    getCurrentEntry,
    getCurrentPrice,
    getEndInfo,
    getLastOccurrence,
    getMonthlyAmount,
    getNextOccurrence,
    getOccurrencesInMonth,
    isRenewalStopped,
    needsEndDate,
    toDayKey,
    todayDayKey,
    type PriceEntry,
} from "./subscription-billing"

const monthly = (overrides: Partial<PriceEntry> = {}): PriceEntry => ({
    amount: 1000,
    currency: "JPY",
    billingCycle: "MONTHLY",
    billingInterval: 1,
    billingDay: 10,
    billingMonth: null,
    effectiveFrom: "2026-01-01",
    ...overrides,
})

describe("toDayKey / todayDayKey", () => {
    it("reads @db.Date values with UTC getters", () => {
        // `@db.Date` はUTCの0時として返る。ローカル時刻で読むと日付が前日になる環境がある
        assert.equal(toDayKey(new Date("2026-09-11T00:00:00.000Z")), "2026-09-11")
    })

    it("returns the JST calendar day", () => {
        // 本番VPSはUTCで動く。JSTの00:00〜09:00は「UTCではまだ前日」なので、
        // ローカル時刻で日付を出すと解約判定と次回更新日が1日ずれる
        // 2026-09-20 15:00 UTC = 2026-09-21 00:00 JST（日付が変わった直後）
        assert.equal(todayDayKey(new Date("2026-09-20T15:00:00.000Z")), "2026-09-21")
        // 2026-09-20 21:00 UTC = 2026-09-21 06:00 JST
        assert.equal(todayDayKey(new Date("2026-09-20T21:00:00.000Z")), "2026-09-21")
        // 2026-09-20 23:00 UTC = 2026-09-21 08:00 JST
        assert.equal(todayDayKey(new Date("2026-09-20T23:00:00.000Z")), "2026-09-21")
        // 2026-09-20 14:00 UTC = 2026-09-20 23:00 JST（まだ前日）
        assert.equal(todayDayKey(new Date("2026-09-20T14:00:00.000Z")), "2026-09-20")
    })

    it("keeps the contract status right in the JST early morning", () => {
        // 終了日 2026-09-20 のサブスクを 2026-09-21 06:00 JST に見たら解約済み。
        // UTCの日付（2026-09-20）で判定すると「解約予定」に見えてしまう
        const jstToday = todayDayKey(new Date("2026-09-20T21:00:00.000Z"))
        assert.equal(getContractStatus("2026-09-20", true, jstToday), "ENDED")
    })
})

describe("daysBetween", () => {
    it("counts calendar days across a month boundary", () => {
        assert.equal(daysBetween("2026-09-20", "2026-10-02"), 12)
        assert.equal(daysBetween("2026-09-20", "2026-09-20"), 0)
        assert.equal(daysBetween("2026-09-20", "2026-09-19"), -1)
    })

    it("counts a leap day", () => {
        assert.equal(daysBetween("2028-02-28", "2028-03-01"), 2)
    })
})

describe("clampToLastDayOfMonth", () => {
    it("clamps a day the month does not have", () => {
        assert.equal(clampToLastDayOfMonth(2026, 2, 31), "2026-02-28")
        assert.equal(clampToLastDayOfMonth(2028, 2, 31), "2028-02-29")
        assert.equal(clampToLastDayOfMonth(2026, 4, 31), "2026-04-30")
    })

    it("keeps a day the month has", () => {
        assert.equal(clampToLastDayOfMonth(2026, 1, 31), "2026-01-31")
    })
})

describe("getMonthlyAmount", () => {
    it("divides by the number of months in the cycle", () => {
        assert.equal(getMonthlyAmount({ amount: 1200, billingCycle: "MONTHLY" }), 1200)
        assert.equal(getMonthlyAmount({ amount: 1500, billingCycle: "MONTHLY", billingInterval: 3 }), 500)
        assert.equal(getMonthlyAmount({ amount: 5900, billingCycle: "YEARLY" }), 5900 / 12)
        assert.equal(getMonthlyAmount({ amount: 4800, billingCycle: "YEARLY", billingInterval: 2 }), 200)
    })
})

describe("convertToJpy", () => {
    it("passes JPY through even without a rate", () => {
        assert.equal(convertToJpy(1000, "JPY", null), 1000)
    })

    it("returns null for USD when the rate is missing", () => {
        assert.equal(convertToJpy(10, "USD", null), null)
        assert.equal(convertToJpy(10, "USD", 152), 1520)
    })
})

describe("formatBillingDay", () => {
    it("spells out the cycle", () => {
        assert.equal(formatBillingDay({ billingCycle: "MONTHLY", billingDay: 26 }), "毎月26日")
        assert.equal(
            formatBillingDay({ billingCycle: "MONTHLY", billingDay: 10, billingInterval: 3 }),
            "3ヶ月ごと10日"
        )
        assert.equal(
            formatBillingDay({ billingCycle: "YEARLY", billingDay: 20, billingMonth: 5 }),
            "毎年5月20日"
        )
        assert.equal(
            formatBillingDay({ billingCycle: "YEARLY", billingDay: 1, billingMonth: 4, billingInterval: 2 }),
            "2年ごと4月1日"
        )
    })
})

describe("getContractStatus", () => {
    it("treats a past end date as ended", () => {
        assert.equal(getContractStatus("2026-06-30", false, "2026-09-20"), "ENDED")
        assert.equal(getContractStatus("2026-06-30", true, "2026-09-20"), "ENDED")
    })

    it("treats today and a future end date as scheduled to end", () => {
        assert.equal(getContractStatus("2026-09-20", false, "2026-09-20"), "SCHEDULED_TO_END")
        assert.equal(getContractStatus("2026-11-30", false, "2026-09-20"), "SCHEDULED_TO_END")
    })

    it("decides by cancelPlanned when the end date is unknown", () => {
        assert.equal(getContractStatus(null, false, "2026-09-20"), "AUTO_RENEWING")
        assert.equal(getContractStatus(null, true, "2026-09-20"), "SCHEDULED_TO_END")
    })
})

describe("getContractStatusLabel", () => {
    it("labels a continuing contract by whether it renews automatically", () => {
        assert.equal(getContractStatusLabel("AUTO_RENEWING", true), "自動更新中")
        assert.equal(getContractStatusLabel("AUTO_RENEWING", false), "自動更新なし")
    })

    it("keeps the scheduled and ended labels whatever the renewal", () => {
        assert.equal(getContractStatusLabel("SCHEDULED_TO_END", true), "解約予定")
        assert.equal(getContractStatusLabel("SCHEDULED_TO_END", false), "解約予定")
        assert.equal(getContractStatusLabel("ENDED", false), "解約済み")
    })
})

describe("getCurrentPrice", () => {
    const prices = [
        monthly({ amount: 6248, effectiveFrom: "2024-04-01" }),
        monthly({ amount: 6480, effectiveFrom: "2026-04-01" }),
    ]

    it("picks the newest price that has already started", () => {
        assert.equal(getCurrentPrice(prices, "2026-09-20").amount, 6480)
        assert.equal(getCurrentPrice(prices, "2026-03-31").amount, 6248)
        assert.equal(getCurrentPrice(prices, "2026-04-01").amount, 6480)
    })

    it("falls back to the oldest price before any of them started", () => {
        assert.equal(getCurrentPrice(prices, "2023-01-01").amount, 6248)
    })

    it("does not depend on the order it is given", () => {
        assert.equal(getCurrentPrice([...prices].reverse(), "2026-09-20").amount, 6480)
    })
})

describe("getCurrentEntry", () => {
    // 支払い方法の変更履歴（Issue #517）のような、`amount` 等を持たない別の履歴にも使える
    const paymentMethods = [
        { paymentMethodId: 1, effectiveFrom: "2025-04-01" },
        { paymentMethodId: 2, effectiveFrom: "2026-04-01" },
    ]

    it("picks the newest entry that has already started", () => {
        assert.equal(getCurrentEntry(paymentMethods, "2026-09-20").paymentMethodId, 2)
        assert.equal(getCurrentEntry(paymentMethods, "2026-03-31").paymentMethodId, 1)
    })

    it("falls back to the oldest entry before any of them started", () => {
        assert.equal(getCurrentEntry(paymentMethods, "2023-01-01").paymentMethodId, 1)
    })
})

describe("getOccurrencesInMonth", () => {
    it("skips months before the contract starts", () => {
        const source = {
            startDate: "2026-03-15",
            endDate: null,
            prices: [monthly({ billingDay: 10, effectiveFrom: "2026-01-01" })],
        }
        assert.deepEqual(getOccurrencesInMonth(source, 2026, 3), [])
        assert.equal(getOccurrencesInMonth(source, 2026, 4)[0].day, "2026-04-10")
    })

    it("stops after the end date", () => {
        const source = {
            startDate: "2026-01-01",
            endDate: "2026-04-05",
            prices: [monthly({ billingDay: 10 })],
        }
        assert.deepEqual(getOccurrencesInMonth(source, 2026, 4), [])
        assert.equal(getOccurrencesInMonth(source, 2026, 3)[0].day, "2026-03-10")
    })

    it("uses the price that was in effect that month", () => {
        const source = {
            startDate: "2024-04-01",
            endDate: null,
            prices: [
                monthly({ amount: 6248, billingDay: 26, effectiveFrom: "2024-04-01" }),
                monthly({ amount: 6480, billingDay: 26, effectiveFrom: "2026-04-01" }),
            ],
        }
        assert.equal(getOccurrencesInMonth(source, 2026, 3)[0].amount, 6248)
        assert.equal(getOccurrencesInMonth(source, 2026, 9)[0].amount, 6480)
    })

    it("only fires on the interval months", () => {
        const source = {
            startDate: "2026-01-01",
            endDate: null,
            prices: [monthly({ billingInterval: 3, billingDay: 10, effectiveFrom: "2026-01-10" })],
        }
        assert.equal(getOccurrencesInMonth(source, 2026, 1).length, 1)
        assert.equal(getOccurrencesInMonth(source, 2026, 2).length, 0)
        assert.equal(getOccurrencesInMonth(source, 2026, 4).length, 1)
    })

    it("only fires in the billing month for a yearly price", () => {
        const source = {
            startDate: "2024-05-20",
            endDate: null,
            prices: [
                monthly({
                    amount: 5900,
                    billingCycle: "YEARLY" as const,
                    billingMonth: 5,
                    billingDay: 20,
                    effectiveFrom: "2024-05-20",
                }),
            ],
        }
        assert.equal(getOccurrencesInMonth(source, 2026, 5)[0].day, "2026-05-20")
        assert.equal(getOccurrencesInMonth(source, 2026, 6).length, 0)
    })

    it("clamps a 31st billing day to the end of February", () => {
        const source = {
            startDate: "2026-01-01",
            endDate: null,
            prices: [monthly({ billingDay: 31 })],
        }
        assert.equal(getOccurrencesInMonth(source, 2026, 2)[0].day, "2026-02-28")
    })
})

describe("getNextOccurrence", () => {
    const source = {
        startDate: "2024-04-01",
        endDate: null,
        prices: [monthly({ billingDay: 26, effectiveFrom: "2024-04-01" })],
    }

    it("includes today", () => {
        assert.equal(getNextOccurrence(source, "2026-09-26")?.day, "2026-09-26")
    })

    it("rolls over into the next month", () => {
        assert.equal(getNextOccurrence(source, "2026-09-27")?.day, "2026-10-26")
    })

    it("crosses the year boundary", () => {
        assert.equal(getNextOccurrence(source, "2026-12-27")?.day, "2027-01-26")
    })

    it("returns null when nothing is left before the end date", () => {
        const ending = { ...source, endDate: "2026-10-01" }
        assert.equal(getNextOccurrence(ending, "2026-09-27"), null)
    })

    it("finds a yearly payment months ahead", () => {
        const yearly = {
            startDate: "2024-05-20",
            endDate: null,
            prices: [
                monthly({
                    amount: 5900,
                    billingCycle: "YEARLY" as const,
                    billingMonth: 5,
                    billingDay: 20,
                    effectiveFrom: "2024-05-20",
                }),
            ],
        }
        assert.equal(getNextOccurrence(yearly, "2026-09-20")?.day, "2027-05-20")
    })
})

describe("formatDayKeyJa", () => {
    it("drops the leading zeros", () => {
        assert.equal(formatDayKeyJa("2026-09-05"), "2026年9月5日")
    })
})

describe("needsEndDate", () => {
    it("flags a scheduled-to-end contract with no end date", () => {
        assert.equal(needsEndDate("SCHEDULED_TO_END", null), true)
    })

    it("does not flag one that has an end date, or one that renews", () => {
        assert.equal(needsEndDate("SCHEDULED_TO_END", "2026-12-31"), false)
        assert.equal(needsEndDate("AUTO_RENEWING", null), false)
        assert.equal(needsEndDate("ENDED", "2026-01-01"), false)
    })
})

describe("getLastOccurrence", () => {
    it("returns the latest billing day on or before the given day", () => {
        const source = { startDate: "2026-01-01", endDate: null, prices: [monthly()] }
        assert.equal(getLastOccurrence(source, "2026-09-10")?.day, "2026-09-10")
        assert.equal(getLastOccurrence(source, "2026-09-09")?.day, "2026-08-10")
    })

    it("crosses a year boundary", () => {
        const source = { startDate: "2025-01-01", endDate: null, prices: [monthly({ effectiveFrom: "2025-01-01" })] }
        assert.equal(getLastOccurrence(source, "2026-01-05")?.day, "2025-12-10")
    })

    it("returns null before the contract starts", () => {
        const source = { startDate: "2026-10-01", endDate: null, prices: [monthly({ effectiveFrom: "2026-10-01" })] }
        assert.equal(getLastOccurrence(source, "2026-09-20"), null)
    })

    it("does not go past the end date", () => {
        const source = { startDate: "2026-01-01", endDate: "2026-06-15", prices: [monthly()] }
        assert.equal(getLastOccurrence(source, "2026-09-20")?.day, "2026-06-10")
    })
})

describe("getEndInfo", () => {
    // さくらのメールボックス: 毎年1/25払い・自動更新しない・終了日未入力（Issue #513）
    const yearlyJan25 = (overrides: Partial<PriceEntry> = {}) =>
        monthly({
            billingCycle: "YEARLY",
            billingMonth: 1,
            billingDay: 25,
            effectiveFrom: "2025-01-25",
            ...overrides,
        })

    it("estimates the usable-until day from the last billing day when the end date is missing", () => {
        const info = getEndInfo(
            { startDate: "2025-01-25", endDate: null, prices: [yearlyJan25()] },
            "2026-09-20"
        )
        assert.deepEqual(info, {
            contractEndDate: null,
            lastBillingDay: "2026-01-25",
            usableUntil: "2027-01-24",
            usableUntilIsEstimate: true,
        })
    })

    it("estimates a monthly plan's usable-until day as the day before the next billing day", () => {
        const info = getEndInfo({ startDate: "2026-01-01", endDate: null, prices: [monthly()] }, "2026-09-20")
        assert.equal(info.lastBillingDay, "2026-09-10")
        assert.equal(info.usableUntil, "2026-10-09")
    })

    it("clamps the next billing day to the end of the month", () => {
        // 31日払いの1月31日に払った場合、次は2月28日なので利用期限はその前日
        const info = getEndInfo(
            { startDate: "2026-01-01", endDate: null, prices: [monthly({ billingDay: 31 })] },
            "2026-01-31"
        )
        assert.equal(info.lastBillingDay, "2026-01-31")
        assert.equal(info.usableUntil, "2026-02-27")
    })

    it("uses the entered end date as-is and keeps the last billing day separate", () => {
        const info = getEndInfo(
            { startDate: "2026-01-01", endDate: "2026-12-31", prices: [monthly()] },
            "2026-09-20"
        )
        assert.deepEqual(info, {
            contractEndDate: "2026-12-31",
            lastBillingDay: "2026-12-10",
            usableUntil: "2026-12-31",
            usableUntilIsEstimate: false,
        })
    })

    it("has no last billing day before the first payment", () => {
        const info = getEndInfo(
            { startDate: "2026-10-01", endDate: null, prices: [monthly({ effectiveFrom: "2026-10-01" })] },
            "2026-09-20"
        )
        assert.equal(info.lastBillingDay, null)
        assert.equal(info.usableUntil, null)
    })
})

describe("isRenewalStopped", () => {
    it("stops only a scheduled-to-end contract with no end date that does not renew", () => {
        assert.equal(isRenewalStopped("SCHEDULED_TO_END", null, false), true)
    })

    it("keeps billing an auto-renewing contract that is only planned to be cancelled", () => {
        assert.equal(isRenewalStopped("SCHEDULED_TO_END", null, true), false)
    })

    it("does not stop a contract that has an end date or keeps going", () => {
        assert.equal(isRenewalStopped("SCHEDULED_TO_END", "2026-12-31", false), false)
        assert.equal(isRenewalStopped("AUTO_RENEWING", null, false), false)
        assert.equal(isRenewalStopped("ENDED", "2026-01-01", false), false)
    })
})
