const YAHOO_CHART_BASE_URL = "https://query1.finance.yahoo.com/v8/finance/chart"

// `range: "max"` は全期間ぶんで応答が大きいので、他の外部通信（zaim-api.ts）と同じ30秒にする
const REQUEST_TIMEOUT_MS = 30_000

export interface IndexDataPoint {
    recordedAt: Date
    value: number
}

interface YahooChartResponse {
    chart: {
        result: {
            timestamp: number[]
            indicators: { quote: { close: (number | null)[] }[] }
        }[] | null
        error: { code: string; description: string } | null
    }
}

/** Yahoo Financeの非公式チャートAPIから日次終値を取得する（symbolはYahoo Finance表記, 例: "^GSPC", "1306.T", "BTC-USD"） */
export async function fetchIndexDailyValues(symbol: string, range: "5d" | "max" = "5d"): Promise<IndexDataPoint[]> {
    const url = `${YAHOO_CHART_BASE_URL}/${encodeURIComponent(symbol)}?range=${range}&interval=1d`
    const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!res.ok) {
        throw new Error(`Yahoo Finance API error (${symbol}): ${res.status}`)
    }

    const data = (await res.json()) as YahooChartResponse
    const result = data.chart.result?.[0]
    if (!result) {
        throw new Error(`Yahoo Finance API error (${symbol}): ${data.chart.error?.description ?? "no data"}`)
    }

    const closes = result.indicators.quote[0]?.close ?? []
    return result.timestamp
        .map((ts, i) => ({ recordedAt: new Date(ts * 1000), value: closes[i] }))
        .filter((p): p is IndexDataPoint => typeof p.value === "number")
}
