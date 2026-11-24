import data from "./municipalities.json"

// municipalities.json の出典: geolonia/japanese-addresses（CC BY 4.0。国土交通省の国土数値情報などが元データ）。
// 政令指定都市の区（札幌市中央区など）は寄付先として選べないため市にまとめ、東京都の特別区は残している。

export type Prefecture = { name: string; municipalities: string[] }
export type Region = { name: string; prefectures: Prefecture[] }

export const REGIONS: Region[] = data

/** 保存する自治体名。市町村の寄付は「北海道 紋別市」、都道府県への寄付は「北海道」 */
export function formatMunicipality(prefecture: string, municipality?: string): string {
    return municipality ? `${prefecture} ${municipality}` : prefecture
}

export function findRegion(name: string): Region | undefined {
    return REGIONS.find((region) => region.name === name)
}

export function findPrefecture(name: string): Prefecture | undefined {
    for (const region of REGIONS) {
        const found = region.prefectures.find((prefecture) => prefecture.name === name)
        if (found) return found
    }
    return undefined
}

/** 保存済みの自治体名から選択位置を復元する。一覧にない表記（旧データ）は undefined */
export function parseMunicipality(value: string): { region: string; prefecture: string; municipality?: string } | undefined {
    const [prefName, ...rest] = value.trim().split(/\s+/)
    const municipality = rest.join(" ") || undefined
    for (const region of REGIONS) {
        const prefecture = region.prefectures.find((p) => p.name === prefName)
        if (!prefecture) continue
        if (municipality && !prefecture.municipalities.includes(municipality)) return undefined
        return { region: region.name, prefecture: prefecture.name, municipality }
    }
    return undefined
}

export function filterMunicipalities(municipalities: string[], query: string): string[] {
    const q = query.trim()
    return q ? municipalities.filter((name) => name.includes(q)) : municipalities
}
