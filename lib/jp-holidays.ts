/**
 * 日本の祝日・営業日の判定（Issue #647）。給料日が土日祝にあたるときの前後営業日の算出に使う。
 *
 * 2000〜2099年を対象にする。春分・秋分は1980〜2099年向けの近似式で、官報の確定値と
 * 一致する範囲に限る。金融機関が休みになる12/31・1/2・1/3も営業日から外す
 * （給料の振込が止まる日であり、祝日そのものではない）。
 */

export type IsoDate = string

const pad = (n: number) => String(n).padStart(2, "0")

export function toIsoDate(year: number, month: number, day: number): IsoDate {
    return `${year}-${pad(month)}-${pad(day)}`
}

function utcMs(iso: IsoDate): number {
    const [y, m, d] = iso.split("-").map(Number)
    return Date.UTC(y, m - 1, d)
}

/** 0=日曜 … 6=土曜 */
export function dayOfWeek(iso: IsoDate): number {
    return new Date(utcMs(iso)).getUTCDay()
}

export function addDays(iso: IsoDate, delta: number): IsoDate {
    return new Date(utcMs(iso) + delta * 86400000).toISOString().slice(0, 10)
}

/** month月の第n月曜日の日（1〜31） */
function nthMonday(year: number, month: number, n: number): number {
    const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay()
    const firstMonday = 1 + ((8 - firstDow) % 7)
    return firstMonday + (n - 1) * 7
}

function vernalEquinoxDay(year: number): number {
    return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4))
}

function autumnalEquinoxDay(year: number): number {
    return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4))
}

/** 国民の祝日（振替休日・国民の休日を含まない本来の祝日）の日付 */
function baseHolidays(year: number): Set<IsoDate> {
    const set = new Set<IsoDate>()
    const add = (m: number, d: number) => set.add(toIsoDate(year, m, d))

    add(1, 1)
    add(1, nthMonday(year, 1, 2)) // 成人の日
    add(2, 11) // 建国記念の日
    if (year >= 2020) add(2, 23) // 天皇誕生日
    add(3, vernalEquinoxDay(year))
    add(4, 29) // 昭和の日（〜2006年はみどりの日）
    add(5, 3)
    if (year >= 2007) add(5, 4) // みどりの日（〜2006年は国民の休日として下で補う）
    add(5, 5)

    // 海の日
    if (year === 2020) add(7, 23)
    else if (year === 2021) add(7, 22)
    else if (year >= 2003) add(7, nthMonday(year, 7, 3))
    else add(7, 20)

    // 山の日
    if (year === 2020) add(8, 10)
    else if (year === 2021) add(8, 8)
    else if (year >= 2016) add(8, 11)

    if (year >= 2003) add(9, nthMonday(year, 9, 3)) // 敬老の日
    else add(9, 15)
    add(9, autumnalEquinoxDay(year))

    // 体育の日（2020年〜スポーツの日）
    if (year === 2020) add(7, 24)
    else if (year === 2021) add(7, 23)
    else add(10, nthMonday(year, 10, 2))

    add(11, 3)
    add(11, 23)
    if (year <= 2018) add(12, 23) // 天皇誕生日（2019年は祝日なし）

    if (year === 2019) {
        add(5, 1) // 即位の日
        add(10, 22) // 即位礼正殿の儀
    }
    return set
}

const cache = new Map<number, Set<IsoDate>>()

/** 振替休日・国民の休日まで含めた、その年の祝日 */
function holidaysOfYear(year: number): Set<IsoDate> {
    const cached = cache.get(year)
    if (cached) return cached

    // 前後の年を見る必要があるのは1/1の振替だけなので、その年の中で完結させる
    const set = baseHolidays(year)
    const base = Array.from(set)

    // 振替休日: 日曜にあたる祝日は、その後で最初の祝日でない日を休みにする
    for (const iso of base) {
        if (dayOfWeek(iso) !== 0) continue
        let next = addDays(iso, 1)
        while (set.has(next)) next = addDays(next, 1)
        set.add(next)
    }

    // 国民の休日: 前日と翌日が祝日の平日（日曜を除く）
    for (let day = utcMs(toIsoDate(year, 1, 2)); day < utcMs(toIsoDate(year, 12, 31)); day += 86400000) {
        const iso = new Date(day).toISOString().slice(0, 10)
        if (set.has(iso) || dayOfWeek(iso) === 0) continue
        if (set.has(addDays(iso, -1)) && set.has(addDays(iso, 1))) set.add(iso)
    }

    cache.set(year, set)
    return set
}

export function isJapaneseHoliday(iso: IsoDate): boolean {
    return holidaysOfYear(Number(iso.slice(0, 4))).has(iso)
}

/** 金融機関が休みになる年末年始（12/31・1/2・1/3。1/1は祝日側で扱う） */
function isYearEndBankHoliday(iso: IsoDate): boolean {
    const md = iso.slice(5)
    return md === "12-31" || md === "01-02" || md === "01-03"
}

export function isBusinessDay(iso: IsoDate): boolean {
    const dow = dayOfWeek(iso)
    if (dow === 0 || dow === 6) return false
    return !isJapaneseHoliday(iso) && !isYearEndBankHoliday(iso)
}

/** iso当日を含めて、前（direction=-1）または後（+1）へ最初の営業日を返す */
export function shiftToBusinessDay(iso: IsoDate, direction: -1 | 1): IsoDate {
    let current = iso
    // 連休は最長でも十数日。無限ループの保険を置く
    for (let i = 0; i < 40 && !isBusinessDay(current); i++) {
        current = addDays(current, direction)
    }
    return current
}
