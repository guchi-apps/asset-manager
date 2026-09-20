import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
    clampToLastDayOfMonth,
    convertToJpy,
    daysBetween,
    formatBillingDay,
    formatDayKeyJa,
    getContractStatus,
    getCurrentPrice,
    getMonthlyAmount,
    getNextOccurrence,
    getOccurrencesInMonth,
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
        // 2026-09-20 23:00 UTC = 2026-09-21 08:00 JST
        assert.equal(todayDayKey(new Date("2026-09-20T23:00:00.000Z")), "2026-09-21")
        // 2026-09-20 14:00 UTC = 2026-09-20 23:00 JST
        assert.equal(todayDayKey(new Date("2026-09-20T14:00:00.000Z")), "2026-09-20")
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
        assert.equal(getContractStatus("2026-06-30", true, "2026-09-20"), "ENDED")
    })

    it("treats today and a future end date as scheduled to end", () => {
        assert.equal(getContractStatus("2026-09-20", true, "2026-09-20"), "SCHEDULED_TO_END")
        assert.equal(getContractStatus("2026-11-30", true, "2026-09-20"), "SCHEDULED_TO_END")
    })

    it("falls back to autoRenew when the end date is unknown", () => {
        assert.equal(getContractStatus(null, true, "2026-09-20"), "AUTO_RENEWING")
        assert.equal(getContractStatus(null, false, "2026-09-20"), "SCHEDULED_TO_END")
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
