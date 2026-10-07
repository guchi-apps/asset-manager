import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { isBusinessDay, isJapaneseHoliday, shiftToBusinessDay } from "./jp-holidays"

describe("isJapaneseHoliday", () => {
    it("固定日・ハッピーマンデー・春分秋分を判定する", () => {
        assert.ok(isJapaneseHoliday("2026-01-12")) // 成人の日（第2月曜）
        assert.ok(isJapaneseHoliday("2026-03-20")) // 春分の日
        assert.ok(isJapaneseHoliday("2026-09-23")) // 秋分の日
        assert.ok(isJapaneseHoliday("2026-11-03"))
        assert.ok(isJapaneseHoliday("2026-07-20")) // 海の日（第3月曜）
        assert.ok(isJapaneseHoliday("2026-10-12")) // スポーツの日
    })

    it("日曜の祝日は翌平日が振替休日になる", () => {
        // 2026-05-03 は日曜。5/4,5/5も祝日なので振替は5/6
        assert.ok(isJapaneseHoliday("2026-05-06"))
        assert.ok(!isJapaneseHoliday("2026-05-07"))
    })

    it("祝日に挟まれた平日は国民の休日になる", () => {
        // 2026-09-21(敬老の日) と 9/23(秋分の日)に挟まれた 9/22
        assert.ok(isJapaneseHoliday("2026-09-22"))
    })

    it("2020・2021年の東京五輪の特例を反映する", () => {
        assert.ok(isJapaneseHoliday("2020-07-23"))
        assert.ok(isJapaneseHoliday("2020-07-24"))
        assert.ok(isJapaneseHoliday("2021-08-08"))
        assert.ok(!isJapaneseHoliday("2020-10-12"))
    })

    it("祝日でない平日は false", () => {
        assert.ok(!isJapaneseHoliday("2026-10-07"))
    })
})

describe("営業日", () => {
    it("土日・祝日・年末年始は営業日でない", () => {
        assert.ok(!isBusinessDay("2026-10-10")) // 土
        assert.ok(!isBusinessDay("2026-10-12")) // スポーツの日
        assert.ok(!isBusinessDay("2026-12-31"))
        assert.ok(!isBusinessDay("2027-01-02"))
        assert.ok(isBusinessDay("2026-10-09")) // 金
    })

    it("前営業日・翌営業日へ寄せる", () => {
        assert.equal(shiftToBusinessDay("2026-10-10", -1), "2026-10-09")
        assert.equal(shiftToBusinessDay("2026-10-10", 1), "2026-10-13") // 月曜は祝日
        assert.equal(shiftToBusinessDay("2026-10-14", 1), "2026-10-14")
    })
})
