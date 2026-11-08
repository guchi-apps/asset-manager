/**
 * 現在地の周辺にあるお店を OpenStreetMap のデータから探す（#1171・#1194）。
 *
 * - 位置情報は検索1回のためだけに使い、保存しない。外部へは小数3桁（約100m）に丸めて送り、
 *   距離（近い順）は自サーバーで丸める前の座標から計算する（「いまいるお店？」を外さないため）
 * - 検索元は Photon（komoot運営、OSMのデータを近い順に返す reverse。実測約1秒）。キー不要
 * - Overpass は実測で19〜32秒かかる・502を返すことがあり（#1194）、#1171 の8秒打ち切りでは
 *   ほぼ毎回失敗していた。いまは Photon が失敗したときの予備で、別枠の10秒だけ待つ（当たれば儲けもの）
 */

export type NearbyPlace = {
    id: string
    name: string
    /** 日本語の業種名（不明なら null） */
    category: string | null
    distanceMeters: number
    lat: number
    lon: number
}

export type Coordinates = { lat: number; lon: number }

/** 丸めで最大約70mずれるぶんを見込んだ半径 */
export const NEARBY_RADIUS_METERS = 500
export const NEARBY_MAX_RESULTS = 10
export const PHOTON_TIMEOUT_MS = 4000
export const OVERPASS_TIMEOUT_MS = 10_000

const PHOTON_REVERSE_ENDPOINT = "https://photon.komoot.io/reverse"
/** 丸めで最大約70mずれるぶん、外部へは広めの半径・多めの件数で問い合わせる */
const PHOTON_RADIUS_KM = NEARBY_RADIUS_METERS / 1000
const PHOTON_LIMIT = 50
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
    return `[out:json][timeout:10];(nwr["shop"]["name"]${around};nwr["amenity"~"^(${amenities})$"]["name"]${around};);out center 80;`
}

function categoryOf(tags: Record<string, string>): string | null {
    if (tags.shop) return SHOP_LABELS[tags.shop] ?? "お店"
    if (tags.amenity) return AMENITY_LABELS[tags.amenity] ?? null
    return null
}

/** 近い順に並べ、同名の重複を除き、最大件数へ切る */
function finalizePlaces(places: NearbyPlace[], limit: number): NearbyPlace[] {
    places.sort((a, b) => a.distanceMeters - b.distanceMeters)
    // 同じ名前の建物と入口など、重複して返るものは近いほうだけ残す
    const seen = new Set<string>()
    const unique = places.filter((p) => (seen.has(p.name) ? false : (seen.add(p.name), true)))
    return unique.slice(0, limit)
}

function toPlace(id: string, rawName: string | undefined, category: string | null, point: Coordinates, center: Coordinates): NearbyPlace | null {
    const name = rawName?.trim()
    if (!name || !Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return null
    return {
        id,
        name: name.slice(0, 191),
        category,
        distanceMeters: Math.round(haversineDistanceMeters(center, point)),
        lat: point.lat,
        lon: point.lon,
    }
}

/** Overpass の応答を、近い順・同名の重複なし・最大件数の一覧へ整える */
export function parseOverpassResponse(body: unknown, center: Coordinates, limit: number = NEARBY_MAX_RESULTS): NearbyPlace[] {
    const elements = (body as { elements?: unknown } | null)?.elements
    if (!Array.isArray(elements)) return []

    const places: NearbyPlace[] = []
    for (const raw of elements as OverpassElement[]) {
        const tags = raw?.tags
        if (!tags) continue
        const point = typeof raw.lat === "number" && typeof raw.lon === "number" ? { lat: raw.lat, lon: raw.lon } : raw.center
        if (!point) continue
        const place = toPlace(`${raw.type}/${raw.id}`, tags["name:ja"] ?? tags.name, categoryOf(tags), point, center)
        if (place) places.push(place)
    }
    return finalizePlaces(places, limit)
}

/**
 * Photon の reverse へ渡すURL。`osm_tag` を付けないと駅の番線・住所・自販機などお店以外が上位に来るため、
 * shop 全般と AMENITY_LABELS の業種だけに絞る（複数の `osm_tag` は OR になる）
 */
export function buildPhotonReverseUrl(center: Coordinates): string {
    const params = new URLSearchParams({
        lat: String(center.lat),
        lon: String(center.lon),
        radius: String(PHOTON_RADIUS_KM),
        limit: String(PHOTON_LIMIT),
    })
    params.append("osm_tag", "shop")
    for (const amenity of Object.keys(AMENITY_LABELS)) params.append("osm_tag", `amenity:${amenity}`)
    return `${PHOTON_REVERSE_ENDPOINT}?${params.toString()}`
}

type PhotonFeature = {
    geometry?: { type?: string; coordinates?: unknown }
    properties?: { osm_type?: string; osm_id?: number; osm_key?: string; osm_value?: string; name?: string }
}

/** Photon の応答（GeoJSON）を整える。絞り込みをすり抜けたお店以外（自販機など）もここで落とす */
export function parsePhotonResponse(body: unknown, center: Coordinates, limit: number = NEARBY_MAX_RESULTS): NearbyPlace[] {
    const features = (body as { features?: unknown } | null)?.features
    if (!Array.isArray(features)) return []

    const places: NearbyPlace[] = []
    for (const feature of features as PhotonFeature[]) {
        const props = feature?.properties
        const coords = feature?.geometry?.coordinates
        if (!props?.osm_key || !props.osm_value || !Array.isArray(coords)) continue
        const isShop = props.osm_key === "shop"
        const isAmenity = props.osm_key === "amenity" && props.osm_value in AMENITY_LABELS
        if (!isShop && !isAmenity) continue
        const [lon, lat] = coords as [unknown, unknown]
        if (typeof lat !== "number" || typeof lon !== "number") continue
        const place = toPlace(
            `${props.osm_type ?? "X"}/${props.osm_id ?? `${lat},${lon}`}`,
            props.name,
            categoryOf({ [props.osm_key]: props.osm_value }),
            { lat, lon },
            center
        )
        if (place) places.push(place)
    }
    return finalizePlaces(places, limit)
}

export class NearbyPlacesUnavailableError extends Error {
    constructor() {
        super("周辺のお店を取得できませんでした")
        this.name = "NearbyPlacesUnavailableError"
    }
}

/**
 * 座標を丸めたうえで Photon へ、失敗したら Overpass へ問い合わせる。距離は丸める前の座標から計算する。
 * 全系統が失敗したら NearbyPlacesUnavailableError
 */
export async function fetchNearbyPlaces(
    rawCenter: Coordinates,
    fetchImpl: typeof fetch = fetch,
    timeouts: { photonMs: number; overpassMs: number } = { photonMs: PHOTON_TIMEOUT_MS, overpassMs: OVERPASS_TIMEOUT_MS }
): Promise<NearbyPlace[]> {
    const rounded = { lat: roundCoordinate(rawCenter.lat), lon: roundCoordinate(rawCenter.lon) }

    try {
        const res = await fetchImpl(buildPhotonReverseUrl(rounded), {
            headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
            signal: AbortSignal.timeout(timeouts.photonMs),
            cache: "no-store",
        })
        if (res.ok) return parsePhotonResponse(await res.json(), rawCenter)
    } catch {
        // Overpass へ。座標をログへ出さないため、エラー内容は記録しない
    }

    const query = buildOverpassQuery(rounded)
    const deadline = Date.now() + timeouts.overpassMs
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
            return parseOverpassResponse(await res.json(), rawCenter)
        } catch {
            // 次の系統へ。座標をログへ出さないため、エラー内容は記録しない
        }
    }
    throw new NearbyPlacesUnavailableError()
}
