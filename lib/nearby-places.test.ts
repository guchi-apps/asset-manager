import assert from "node:assert/strict"
import { test } from "node:test"
import {
    NearbyPlacesUnavailableError,
    buildOverpassQuery,
    buildPhotonReverseUrl,
    fetchNearbyPlaces,
    parseCoordinates,
    parseOverpassResponse,
    parsePhotonResponse,
    roundCoordinate,
} from "./nearby-places"

const center = { lat: 35.681, lon: 139.767 }

test("座標は小数3桁へ丸める", () => {
    assert.equal(roundCoordinate(35.68123456), 35.681)
    assert.equal(roundCoordinate(139.7679), 139.768)
})

test("parseCoordinates は妥当な数値だけ通す", () => {
    assert.deepEqual(parseCoordinates("35.6", "139.7"), { lat: 35.6, lon: 139.7 })
    assert.equal(parseCoordinates("abc", "139.7"), null)
    assert.equal(parseCoordinates("", "139.7"), null)
    assert.equal(parseCoordinates(91, 0), null)
    assert.equal(parseCoordinates(0, 181), null)
    assert.equal(parseCoordinates(null, undefined), null)
})

test("問い合わせは座標と半径を含む", () => {
    const q = buildOverpassQuery(center, 300)
    assert.ok(q.includes("around:300,35.681,139.767"))
    assert.ok(q.includes('["shop"]'))
})

test("応答は近い順・同名の重複なし・件数上限で整う", () => {
    const body = {
        elements: [
            { type: "node", id: 1, lat: 35.683, lon: 139.767, tags: { name: "遠い店", shop: "supermarket" } },
            { type: "node", id: 2, lat: 35.6811, lon: 139.767, tags: { name: "近い店", shop: "convenience" } },
            { type: "way", id: 3, center: { lat: 35.6815, lon: 139.767 }, tags: { name: "近い店", shop: "convenience" } },
            { type: "node", id: 4, lat: 35.68, lon: 139.767, tags: { shop: "bakery" } },
            { type: "node", id: 5, lat: 35.6812, lon: 139.767, tags: { name: "カフェA", amenity: "cafe" } },
        ],
    }
    const result = parseOverpassResponse(body, center, 2)
    assert.deepEqual(
        result.map((p) => [p.name, p.category]),
        [
            ["近い店", "コンビニ"],
            ["カフェA", "カフェ"],
        ]
    )
    assert.ok(result[0].distanceMeters <= result[1].distanceMeters)
})

test("応答が不正なら空配列", () => {
    assert.deepEqual(parseOverpassResponse(null, center), [])
    assert.deepEqual(parseOverpassResponse({ elements: "x" }, center), [])
})

const fastTimeouts = { photonMs: 1000, overpassMs: 1000 }

test("Photon への問い合わせは shop と対象の amenity だけに絞る", () => {
    const url = new URL(buildPhotonReverseUrl(center))
    const tags = url.searchParams.getAll("osm_tag")
    assert.ok(tags.includes("shop"))
    assert.ok(tags.includes("amenity:cafe"))
    assert.ok(!tags.includes("amenity"))
    assert.equal(url.searchParams.get("lat"), "35.681")
})

const feature = (key: string, value: string, name: string | undefined, lat: number, lon: number, id: number) => ({
    type: "Feature",
    properties: { osm_type: "N", osm_id: id, osm_key: key, osm_value: value, name },
    geometry: { type: "Point", coordinates: [lon, lat] },
})

test("Photon の応答はお店以外を落とし、近い順・同名の重複なし・件数上限で整う", () => {
    const body = {
        features: [
            feature("railway", "platform", "東京駅7・8番線ホーム", 35.681, 139.767, 1),
            feature("amenity", "vending_machine", "自販機", 35.681, 139.767, 2),
            feature("shop", "supermarket", "遠い店", 35.683, 139.767, 3),
            feature("shop", "convenience", "近い店", 35.6812, 139.767, 4),
            feature("shop", "convenience", "近い店", 35.6815, 139.767, 5),
            feature("amenity", "cafe", "カフェA", 35.6811, 139.767, 6),
            feature("shop", "ticket", "みどりの窓口", 35.6813, 139.767, 7),
            feature("shop", "bakery", undefined, 35.681, 139.767, 8),
        ],
    }
    const result = parsePhotonResponse(body, center, 3)
    assert.deepEqual(
        result.map((p) => [p.name, p.category]),
        [
            ["カフェA", "カフェ"],
            ["近い店", "コンビニ"],
            ["みどりの窓口", "お店"],
        ]
    )
    assert.equal(result[0].id, "N/6")
    assert.deepEqual([result[0].lat, result[0].lon], [35.6811, 139.767])
    assert.deepEqual(parsePhotonResponse({ features: "x" }, center), [])
})

test("fetchNearbyPlaces は Photon へ丸めた座標だけを送り、距離は丸める前の座標で測る", async () => {
    const urls: string[] = []
    const fetchStub = (async (url: string) => {
        urls.push(url)
        return Response.json({
            features: [feature("shop", "convenience", "北の店", 35.6815, 139.767, 1), feature("shop", "convenience", "南の店", 35.6805, 139.767, 2)],
        })
    }) as unknown as typeof fetch
    // 丸めると 35.681（両店から等距離）になるが、実際の現在地は南の店のすぐそば
    const result = await fetchNearbyPlaces({ lat: 35.68062, lon: 139.76712345 }, fetchStub, fastTimeouts)
    assert.equal(urls.length, 1)
    assert.ok(urls[0].startsWith("https://photon.komoot.io/reverse?"))
    assert.ok(urls[0].includes("lat=35.681&lon=139.767"))
    assert.ok(!urls[0].includes("35.68062"))
    assert.equal(result[0].name, "南の店")
})

test("fetchNearbyPlaces は Photon が失敗したら Overpass の2系統を順に使い、丸めた座標だけを送る", async () => {
    const calls: { url: string; body: string }[] = []
    const fetchStub = (async (url: string, init: RequestInit) => {
        calls.push({ url, body: String(init.body) })
        if (calls.length <= 2) return new Response("busy", { status: calls.length === 1 ? 502 : 429 })
        return Response.json({ elements: [{ type: "node", id: 9, lat: 35.681, lon: 139.767, tags: { name: "店", shop: "supermarket" } }] })
    }) as unknown as typeof fetch
    const result = await fetchNearbyPlaces({ lat: 35.68123456, lon: 139.76712345 }, fetchStub, fastTimeouts)
    assert.equal(calls.length, 3)
    assert.ok(calls[0].url.includes("photon"))
    assert.ok(calls[1].url.includes("overpass"))
    assert.equal(result[0].name, "店")
    const sent = decodeURIComponent(calls[1].body)
    assert.ok(sent.includes("35.681,139.767"))
    assert.ok(!sent.includes("35.68123456"))
})

test("全系統が失敗したら NearbyPlacesUnavailableError", async () => {
    const fetchStub = (async () => {
        throw new Error("network")
    }) as unknown as typeof fetch
    await assert.rejects(() => fetchNearbyPlaces(center, fetchStub, fastTimeouts), NearbyPlacesUnavailableError)
})
