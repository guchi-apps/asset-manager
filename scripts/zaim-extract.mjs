export function parseYen(text) {
    const normalized = String(text).replace(/[￥¥]/g, "").replace(/,/g, "").replace(/\s/g, "").trim()
    if (!/^-?\d+$/.test(normalized)) return null
    const value = Number(normalized)
    return Number.isFinite(value) ? value : null
}

export function normalizeZaimName(text) {
    return String(text).replace(/\s+/g, "").trim()
}

export function normalizeItems(items, source, url) {
    const seen = new Set()
    const normalized = []
    for (const item of items) {
        const name = String(item.name ?? "").replace(/\s+/g, " ").trim()
        const amount = parseYen(item.amount)
        if (!name || amount === null) continue
        const key = `${normalizeZaimName(name)}\u0000${amount}`
        if (seen.has(key)) continue
        seen.add(key)
        normalized.push({ name, amount, source, url })
    }
    return normalized
}

export function mergeBalances(homeBalances, securityHoldings) {
    const merged = new Map()
    for (const balance of homeBalances) merged.set(normalizeZaimName(balance.name), balance)
    for (const holding of securityHoldings) {
        const key = normalizeZaimName(holding.name)
        const existing = merged.get(key)
        merged.set(key, existing?.source === "securityHolding"
            ? { ...holding, amount: existing.amount + holding.amount }
            : holding)
    }
    return [...merged.values()]
}
