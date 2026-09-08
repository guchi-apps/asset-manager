export interface Category {
    id: number
    name: string
    currentValue: number
    costBasis: number
    ownValue?: number
    ownCostBasis?: number
    color?: string
    order?: number
    parentId?: number | null
    isCash?: boolean
    isLiability?: boolean
    excludeFromInvestmentView?: boolean
    tags?: string[]
    tagSettings?: {
        groupId: number;
        groupName: string;
        optionId: number | null;
        optionName: string;
    }[];
    conflicts?: string[]
    depth?: number
    dailyChange?: number
    dailyChangeRate?: number
    dailyChangeDays?: number
    monthlyChange?: number
    monthlyChangeRate?: number
    monthlyChangeDays?: number
    realizedGain?: number
    lastUpdated?: Date
    hidden?: boolean
}

export interface HistoryPoint {
    date: string
    totalAssets: number | null
    totalCost: number | null
    netWorth?: number | null
    /** 負債の合計。**正の値**で入る（#344・`lib/asset-breakdown.ts`） */
    totalLiabilities?: number | null
    [key: string]: string | number | boolean | null | undefined
}

export interface TagGroup {
    id: number
    name: string
    tags?: string[]
    options?: { id: number, name: string }[]
}

export type ChartViewMode = "value" | "cost" | "percent" | "pnl" | "pnlValue" | "realizedGain"
