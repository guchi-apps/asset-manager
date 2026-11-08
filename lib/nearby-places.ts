/**
 * 現在地の周辺にあるお店を OpenStreetMap の Overpass API で探す（#1171）。
 *
 * - 位置情報は検索1回のためだけに使い、保存しない。外部へは小数3桁（約100m）に丸めて送る
 * - APIキーは不要（car-care の周辺ガソリンスタンド検索と同じ方式）
 * - Overpass は無料の共有サービスで遅い・落ちることがあるため、2系統へ順に当て、8秒で諦める
 */

export type NearbyPlace = {
    id: string
    name: string
    /** 日本語の業種名（不明なら null） */
    category: string | null
    distanceMeters: number
}

export type Coordinates = { lat: number; lon: number }

export const NEARBY_RADIUS_METERS = 400
export const NEARBY_MAX_RESULTS = 10
export const NEARBY_TIMEOUT_MS = 8000

const OVERPASS_ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"] as const
const USER_AGENT = "AssetManager/1.0 (asset-manager nearby-places)"

const SHOP_LABELS: Record<string, string> = {
    supermarket: "スーパーマーケット",
    convenience: "コンビニ",
    chemist: "ドラッグストア",
    bakery: "パン屋",
    clothes: "衣料品店",
    department_store: "百貨店",
    electronics: "家電量販店",
    doityourself: "ホームセンター",
    books: "書店",
    variety_store: "雑貨店",
    butcher: "精肉店",
    greengrocer: "八百屋",
    alcohol: "酒店",
    mall: "ショッピングモール",
}

const AMENITY_LABELS: Record<string, string> = {
    restaurant: "飲食店",
    cafe: "カフェ",
    fast_food: "ファストフード",
    bar: "バー",
    pub: "居酒屋",
    food_court: "フードコート",
    pharmacy: "薬局",
    fuel: "ガソリンスタンド",
    cinema: "映画館",
    bank: "銀行",
}

type OverpassElement = {
    type: "node" | "way" | "relation"
    id: number
    lat?: number
    lon?: number
    center?: { lat: number; lon: number }
    tags?: Record<string, string>
}

/** 約100m。小数3桁へ丸める */
export function roundCoordinate(value: number): number {
    return Math.round(value * 1000) / 1000
}

/** 緯度経度として妥当な数値の組だけを通す。それ以外は null */
export function parseCoordinates(lat: unknown, lon: unknown): Coordinates | null {
    const la = typeof lat === "string" && lat.trim() !== "" ? Number(lat) : lat
    const lo = typeof lon === "string" && lon.trim() !== "" ? Number(lon) : lon
    if (typeof la !== "number" || typeof lo !== "number") return null
    if (!Number.isFinite(la) || !Number.isFinite(lo)) return null
    if (la < -90 || la > 90 || lo < -180 || lo > 180) return null
    return { lat: la, lon: lo }
}

export function haversineDistanceMeters(a: Coordinates, b: Coordinates): number {
    const earthRadius = 6_371_000
    const rad = (v: number) => (v * Math.PI) / 180
    const dLat = rad(b.lat - a.lat)
    const dLon = rad(b.lon - a.lon)
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2
    return earthRadius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

export function buildOverpassQuery(center: Coordinates, radius: number = NEARBY_RADIUS_METERS): string {
    const around = `(around:${radius},${center.lat},${center.lon})`
    const amenities = Object.keys(AMENITY_LABELS).join("|")
    return `[out:json][timeout:8];(nwr["shop"]["name"]${around};nwr["amenity"~"^(${amenities})$"]["name"]${around};);out center 80;`
}

function categoryOf(tags: Record<string, string>): string | null {
    if (tags.shop) return SHOP_LABELS[tags.shop] ?? "お店"
    if (tags.amenity) return AMENITY_LABELS[tags.amenity] ?? null
    return null
}

/** Overpass の応答を、近い順・同名の重複なし・最大件数の一覧へ整える */
export function parseOverpassResponse(body: unknown, center: Coordinates, limit: number = NEARBY_MAX_RESULTS): NearbyPlace[] {
    const elements = (body as { elements?: unknown } | null)?.elements
    if (!Array.isArray(elements)) return []

    const places: NearbyPlace[] = []
    for (const raw of elements as OverpassElement[]) {
        const tags = raw?.tags
        const name = (tags?.["name:ja"] ?? tags?.name)?.trim()
        if (!tags || !name) continue
        const point = typeof raw.lat === "number" && typeof raw.lon === "number" ? { lat: raw.lat, lon: raw.lon } : raw.center
        if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lon)) continue
        places.push({
            id: `${raw.type}/${raw.id}`,
            name: name.slice(0, 191),
            category: categoryOf(tags),
            distanceMeters: Math.round(haversineDistanceMeters(center, point)),
        })
    }

    places.sort((a, b) => a.distanceMeters - b.distanceMeters)
    // 同じ名前の建物と入口など、重複して返るものは近いほうだけ残す
    const seen = new Set<string>()
    const unique = places.filter((p) => (seen.has(p.name) ? false : (seen.add(p.name), true)))
    return unique.slice(0, limit)
}

export class NearbyPlacesUnavailableError extends Error {
    constructor() {
        super("周辺のお店を取得できませんでした")
        this.name = "NearbyPlacesUnavailableError"
    }
}

/** 座標を丸めたうえで Overpass へ問い合わせる。全系統が失敗したら NearbyPlacesUnavailableError */
export async function fetchNearbyPlaces(
    rawCenter: Coordinates,
    fetchImpl: typeof fetch = fetch,
    timeoutMs: number = NEARBY_TIMEOUT_MS
): Promise<NearbyPlace[]> {
    const center = { lat: roundCoordinate(rawCenter.lat), lon: roundCoordinate(rawCenter.lon) }
    const query = buildOverpassQuery(center)
    const deadline = Date.now() + timeoutMs

    for (const endpoint of OVERPASS_ENDPOINTS) {
        const remaining = deadline - Date.now()
        if (remaining <= 0) break
        try {
            const res = await fetchImpl(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
                body: new URLSearchParams({ data: query }).toString(),
                signal: AbortSignal.timeout(remaining),
                cache: "no-store",
            })
            if (!res.ok) continue
            return parseOverpassResponse(await res.json(), center)
        } catch {
            // 次の系統へ。座標をログへ出さないため、エラー内容は記録しない
        }
    }
    throw new NearbyPlacesUnavailableError()
}
