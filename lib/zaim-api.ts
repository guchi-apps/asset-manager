export interface ZaimBalance {
    name: string
    amount: number
}

interface ZaimAccountResponse {
    accounts?: Array<{
        name?: string
        balance?: number | string
    }>
}

/**
 * Fetch balances from Zaim using a bearer token compatible endpoint.
 *
 * The endpoint is configurable because Zaim's public developer API documentation
 * is not currently stable/clearly published. This keeps the sync layer isolated
 * from the rest of the application and allows the concrete API contract to be
 * changed without touching valuation persistence logic.
 */
export async function fetchZaimBalances(): Promise<ZaimBalance[]> {
    const endpoint = process.env.ZAIM_BALANCES_ENDPOINT
    const token = process.env.ZAIM_ACCESS_TOKEN

    if (!endpoint) {
        throw new Error("ZAIM_BALANCES_ENDPOINT is not configured")
    }
    if (!token) {
        throw new Error("ZAIM_ACCESS_TOKEN is not configured")
    }

    const response = await fetch(endpoint, {
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
        },
        cache: "no-store",
    })

    if (!response.ok) {
        throw new Error(`Zaim API request failed: ${response.status}`)
    }

    const data = (await response.json()) as ZaimAccountResponse
    const accounts = Array.isArray(data.accounts) ? data.accounts : []

    return accounts
        .map((account) => ({
            name: account.name?.trim() ?? "",
            amount: Number(account.balance),
        }))
        .filter((account) => account.name.length > 0 && Number.isFinite(account.amount))
}
