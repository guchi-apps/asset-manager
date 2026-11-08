import assert from "node:assert/strict"
import { test } from "node:test"
import {
    NearbyPlacesUnavailableError,
    buildOverpassQuery,
    fetchNearbyPlaces,
    parseCoordinates,
    parseOverpassResponse,
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

test("fetchNearbyPlaces は1系統目が失敗したら2系統目を使い、丸めた座標だけを送る", async () => {
    const calls: { url: string; body: string }[] = []
    const fetchStub = (async (url: string, init: RequestInit) => {
        calls.push({ url, body: String(init.body) })
        if (calls.length === 1) return new Response("busy", { status: 429 })
        return Response.json({ elements: [{ type: "node", id: 9, lat: 35.681, lon: 139.767, tags: { name: "店", shop: "supermarket" } }] })
    }) as unknown as typeof fetch
    const result = await fetchNearbyPlaces({ lat: 35.68123456, lon: 139.76712345 }, fetchStub)
    assert.equal(calls.length, 2)
    assert.equal(result[0].name, "店")
    const sent = decodeURIComponent(calls[0].body)
    assert.ok(sent.includes("35.681,139.767"))
    assert.ok(!sent.includes("35.68123456"))
})

test("全系統が失敗したら NearbyPlacesUnavailableError", async () => {
    const fetchStub = (async () => {
        throw new Error("network")
    }) as unknown as typeof fetch
    await assert.rejects(() => fetchNearbyPlaces(center, fetchStub), NearbyPlacesUnavailableError)
})
