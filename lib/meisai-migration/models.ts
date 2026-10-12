import { createHash } from "node:crypto"

/**
 * 明細ラボ（guchi-apps/meisai-lab）から Asset Manager へ写すモデルの定義（Issue #717）。
 *
 * 移行先のモデルは #714〜#716 で列名・id の方式（cuid）を移行元と同じにしてあるため、行は **id を変えずに**
 * そのまま写す。`Salary.data` / `Bonus.data` の `customItemValues`・`itemSnapshots` は項目（`Item` → `PayItem`）の
 * id をキーに持つので、id を保てば JSON 内の参照も張り替えずに済む。
 *
 * 移行元（mysql2 で読んだ生の値）と移行先（Prisma で読んだ値）を同じ形に正規化し、内容のハッシュで
 * 「変わっていないか」を判定する。ハッシュには userId・作成/更新日時を含めない（ユーザーは両アプリで id が違い、
 * 日時は内容ではないため）。削除状態（`deletedAt`）は内容に含める。
 */

export type FieldKind = "string" | "nullableString" | "int" | "bool" | "decimal2" | "decimal4" | "date" | "nullableDate" | "json"

export type ModelSpec = {
    /** 移行先の Prisma モデル名（`prisma.<delegate>` の名前） */
    target: MigrationModel
    /** 移行元のテーブル名 */
    sourceTable: string
    /** 内容として写す列（id・userId・createdAt・updatedAt 以外） */
    fields: Record<string, FieldKind>
    /** `@@unique([userId, ...])` の列。移行と無関係な行と同じキーなら衝突にする */
    naturalKey: string[]
    /** 移行元・移行先に updatedAt 列があるか（Deduction には無い） */
    hasUpdatedAt: boolean
    /** 照合で年別に分ける列。無ければ年を持たない（"-" にまとめる） */
    yearOf?: (fields: NormalizedFields) => number | null
    /** 照合で合計する金額の列 */
    amountFields: string[]
    /** 照合・画面で使う説明 */
    label: string
}

export const MIGRATION_MODELS = [
    "payItem",
    "taxSetting",
    "salary",
    "bonus",
    "deduction",
    "taxCalculationOverride",
    "furusatoDonation",
] as const

export type MigrationModel = (typeof MIGRATION_MODELS)[number]

export type NormalizedValue = string | number | boolean | null | NormalizedJson
export type NormalizedJson = { [key: string]: unknown } | unknown[]
export type NormalizedFields = Record<string, NormalizedValue>

const yearFromDate = (key: string) => (fields: NormalizedFields) => {
    const value = fields[key]
    return typeof value === "string" ? Number(value.slice(0, 4)) : null
}
const yearFromInt = (key: string) => (fields: NormalizedFields) => {
    const value = fields[key]
    return typeof value === "number" ? value : null
}

/** 書き込み順。項目（PayItem）を明細より先に写す（明細の JSON が項目の id を指すため）。 */
export const MODEL_SPECS: Record<MigrationModel, ModelSpec> = {
    payItem: {
        target: "payItem",
        sourceTable: "Item",
        fields: {
            itemName: "string",
            itemType: "string",
            scope: "string",
            isTaxable: "bool",
            displayOrder: "int",
            isActive: "bool",
        },
        naturalKey: ["itemName"],
        hasUpdatedAt: true,
        amountFields: [],
        label: "給与・賞与の項目（Item → PayItem）",
    },
    taxSetting: {
        target: "taxSetting",
        sourceTable: "TaxSetting",
        fields: {
            effectiveFrom: "date",
            healthInsuranceRate: "decimal4",
            pensionRate: "decimal4",
            employmentInsuranceRate: "decimal4",
            incomeRateTaxFormula: "nullableString",
        },
        naturalKey: ["effectiveFrom"],
        hasUpdatedAt: true,
        yearOf: yearFromDate("effectiveFrom"),
        amountFields: [],
        label: "保険料率（TaxSetting）",
    },
    salary: {
        target: "salary",
        sourceTable: "Salary",
        fields: {
            salaryDate: "date",
            grossSalary: "decimal2",
            netSalary: "decimal2",
            data: "json",
            memo: "nullableString",
            deletedAt: "nullableDate",
        },
        naturalKey: ["salaryDate"],
        hasUpdatedAt: true,
        yearOf: yearFromDate("salaryDate"),
        amountFields: ["grossSalary", "netSalary"],
        label: "給与明細（Salary）",
    },
    bonus: {
        target: "bonus",
        sourceTable: "Bonus",
        fields: {
            bonusDate: "date",
            amount: "decimal2",
            data: "json",
            memo: "nullableString",
            deletedAt: "nullableDate",
        },
        naturalKey: ["bonusDate"],
        hasUpdatedAt: true,
        yearOf: yearFromDate("bonusDate"),
        amountFields: ["amount"],
        label: "賞与明細（Bonus）",
    },
    deduction: {
        target: "deduction",
        sourceTable: "Deduction",
        fields: {
            deductionType: "string",
            amount: "decimal2",
            year: "int",
            note: "nullableString",
        },
        naturalKey: ["year", "deductionType"],
        hasUpdatedAt: false,
        yearOf: yearFromInt("year"),
        amountFields: ["amount"],
        label: "年次控除（Deduction）",
    },
    taxCalculationOverride: {
        target: "taxCalculationOverride",
        sourceTable: "TaxCalculationOverride",
        fields: {
            year: "int",
            field: "string",
            amount: "decimal2",
        },
        naturalKey: ["year", "field"],
        hasUpdatedAt: true,
        yearOf: yearFromInt("year"),
        amountFields: ["amount"],
        label: "税計算の上書き・確定値（TaxCalculationOverride）",
    },
    furusatoDonation: {
        target: "furusatoDonation",
        sourceTable: "FurusatoDonation",
        fields: {
            year: "int",
            donatedAt: "date",
            municipality: "string",
            amount: "decimal2",
            returnItem: "nullableString",
            category: "nullableString",
            portalSite: "nullableString",
            receiveFrom: "nullableDate",
            receiveTo: "nullableDate",
            oneStopStatus: "string",
            certificateStatus: "string",
            memo: "nullableString",
            deletedAt: "nullableDate",
        },
        // 移行元に一意制約が無い（同じ日に同じ自治体へ複数回寄付できる）ため、id でしか突き合わせない
        naturalKey: [],
        hasUpdatedAt: true,
        yearOf: yearFromInt("year"),
        amountFields: ["amount"],
        label: "ふるさと納税の寄付（FurusatoDonation）",
    },
}

/** 正規化した1行。移行元・移行先で同じ形にする。 */
export type NormalizedRow = {
    id: string
    userId: string
    fields: NormalizedFields
    createdAt: string
    /** updatedAt 列が無いモデル（Deduction）では null */
    updatedAt: string | null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * `Decimal` を小数点以下 `scale` 桁の文字列にそろえる。移行元（mysql2）は "300000.00" の文字列、
 * 移行先（Prisma）は Decimal オブジェクトで返る。浮動小数点を通さないよう文字列で扱う。
 */
export function canonicalDecimal(raw: unknown, scale: number): string {
    if (raw === null || raw === undefined) throw new Error("Decimal の値がありません")
    const text =
        typeof raw === "object" && "toFixed" in raw && typeof (raw as { toFixed: unknown }).toFixed === "function"
            ? (raw as { toFixed: (dp: number) => string }).toFixed(scale)
            : String(raw).trim()
    const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text)
    if (!match) throw new Error(`Decimal として読めない値です: ${text}`)
    const [, sign, intPart, fracPart = ""] = match
    if (fracPart.length > scale && /[1-9]/.test(fracPart.slice(scale))) {
        throw new Error(`小数点以下が${scale}桁を超えています: ${text}`)
    }
    const frac = (fracPart + "0".repeat(scale)).slice(0, scale)
    const int = intPart.replace(/^0+(?=\d)/, "")
    const isZero = /^0+$/.test(int + frac)
    return `${isZero ? "" : sign}${int}${scale > 0 ? `.${frac}` : ""}`
}

/**
 * 日時を UTC の ISO8601（ミリ秒まで）にそろえる。移行元は mysql2 の `dateStrings: true` で
 * "2026-01-25 00:00:00.000" の文字列（UTC として保存されている）、移行先は Date で返る。
 */
export function canonicalDate(raw: unknown): string {
    if (raw instanceof Date) {
        if (Number.isNaN(raw.getTime())) throw new Error("不正な日時です")
        return raw.toISOString()
    }
    if (typeof raw === "string") {
        const text = raw.trim()
        const iso = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(text)
            ? `${text.replace(" ", "T")}Z`
            : /^\d{4}-\d{2}-\d{2}$/.test(text)
              ? `${text}T00:00:00Z`
              : text
        const date = new Date(iso)
        if (Number.isNaN(date.getTime())) throw new Error(`日時として読めない値です: ${raw}`)
        return date.toISOString()
    }
    throw new Error(`日時として読めない値です: ${String(raw)}`)
}

/** JSON 列は MySQL では解析済み、MariaDB（JSON は LONGTEXT の別名）では文字列で返る。 */
export function canonicalJson(raw: unknown): NormalizedJson {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw
    if (!isRecord(value) && !Array.isArray(value)) throw new Error("JSON の値がオブジェクトではありません")
    return value as NormalizedJson
}

export function normalizeValue(kind: FieldKind, raw: unknown): NormalizedValue {
    switch (kind) {
        case "string":
            if (typeof raw !== "string") throw new Error(`文字列ではありません: ${String(raw)}`)
            return raw
        case "nullableString":
            if (raw === null || raw === undefined) return null
            if (typeof raw !== "string") throw new Error(`文字列ではありません: ${String(raw)}`)
            return raw
        case "int": {
            const value = typeof raw === "string" ? Number(raw) : raw
            if (typeof value !== "number" || !Number.isInteger(value)) throw new Error(`整数ではありません: ${String(raw)}`)
            return value
        }
        case "bool":
            // MySQL の TINYINT(1) は mysql2 では 0/1 の数値で返る
            if (typeof raw === "boolean") return raw
            if (raw === 0 || raw === 1) return raw === 1
            if (raw === "0" || raw === "1") return raw === "1"
            throw new Error(`真偽値ではありません: ${String(raw)}`)
        case "decimal2":
            return canonicalDecimal(raw, 2)
        case "decimal4":
            return canonicalDecimal(raw, 4)
        case "date":
            return canonicalDate(raw)
        case "nullableDate":
            return raw === null || raw === undefined ? null : canonicalDate(raw)
        case "json":
            return canonicalJson(raw)
    }
}

/** 生の行（移行元・移行先どちらでも）を正規化する。読めない値は列名付きで投げる。 */
export function normalizeRow(spec: ModelSpec, raw: Record<string, unknown>): NormalizedRow {
    const fields: NormalizedFields = {}
    for (const [name, kind] of Object.entries(spec.fields)) {
        try {
            fields[name] = normalizeValue(kind, raw[name])
        } catch (error) {
            throw new Error(`${spec.sourceTable} ${String(raw.id)} の ${name}: ${(error as Error).message}`)
        }
    }
    return {
        id: String(raw.id),
        userId: String(raw.userId),
        fields,
        createdAt: canonicalDate(raw.createdAt),
        updatedAt: spec.hasUpdatedAt ? canonicalDate(raw.updatedAt) : null,
    }
}

/** キーの順序に依らない JSON 文字列。 */
export function stableStringify(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
    if (isRecord(value)) {
        return `{${Object.keys(value)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
            .join(",")}}`
    }
    return JSON.stringify(value === undefined ? null : value)
}

/** 内容のハッシュ。userId・作成/更新日時は含めない。 */
export function contentHash(row: Pick<NormalizedRow, "fields">): string {
    return createHash("sha256").update(stableStringify(row.fields)).digest("hex")
}

/** 一意制約のキー（`@@unique([userId, ...])` の userId 以外）。キーを持たないモデルは null。 */
export function naturalKeyOf(spec: ModelSpec, row: Pick<NormalizedRow, "fields">): string | null {
    if (spec.naturalKey.length === 0) return null
    return spec.naturalKey.map((name) => stableStringify(row.fields[name])).join("|")
}

/** 給与・賞与の `data` が指している項目の id（`customItemValues` と `itemSnapshots` のキー）。 */
export function referencedItemIds(data: NormalizedValue): { values: string[]; snapshots: string[] } {
    if (!isRecord(data)) return { values: [], snapshots: [] }
    const values = isRecord(data.customItemValues) ? Object.keys(data.customItemValues) : []
    const snapshots = isRecord(data.itemSnapshots) ? Object.keys(data.itemSnapshots) : []
    return { values, snapshots }
}
