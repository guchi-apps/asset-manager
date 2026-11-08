"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import type { Coordinates } from "@/lib/nearby-places"

/**
 * 現在地を中心に、OpenStreetMap のタイル画像を並べて印を重ねる静的な地図（#1194）。
 * 依存を足さないため、動かす・拡大はできない。印が収まるようにズームだけを選ぶ。
 *
 * 枠の幅は測らず、中心からの相対位置（`calc(50% + Npx)`）で置くので、幅が変わっても中心は保たれる。
 */

const TILE_SIZE = 256
const MAX_ZOOM = 18
const MIN_ZOOM = 15
/** 枠の高さの半分より少し内側に印が収まるズームを選ぶ（高さ h-52 = 208px） */
const FIT_HALF_HEIGHT = 85
/** 横は最大幅（sm:max-w-xl = 576px）の半分を覆えるだけタイルを並べる */
const COVER_HALF_WIDTH = 300
const COVER_HALF_HEIGHT = 110

/** Web メルカトルのワールド座標（px）へ */
function project(point: Coordinates, zoom: number): { x: number; y: number } {
    const scale = TILE_SIZE * 2 ** zoom
    const sinLat = Math.sin((point.lat * Math.PI) / 180)
    return {
        x: ((point.lon + 180) / 360) * scale,
        y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale,
    }
}

function chooseZoom(center: Coordinates, markers: Coordinates[]): number {
    for (let zoom = MAX_ZOOM; zoom > MIN_ZOOM; zoom--) {
        const c = project(center, zoom)
        const fits = markers.every((m) => {
            const p = project(m, zoom)
            return Math.abs(p.x - c.x) <= FIT_HALF_HEIGHT * 1.6 && Math.abs(p.y - c.y) <= FIT_HALF_HEIGHT
        })
        if (fits) return zoom
    }
    return MIN_ZOOM
}

export type NearbyMapMarker = Coordinates & { id: string; label: string; highlighted?: boolean }

export function NearbyPlaceMap({ center, markers = [], className }: { center: Coordinates; markers?: NearbyMapMarker[]; className?: string }) {
    const zoom = React.useMemo(() => chooseZoom(center, markers), [center, markers])
    const c = project(center, zoom)
    const maxTile = 2 ** zoom - 1

    const tiles: { key: string; src: string; left: number; top: number }[] = []
    for (let tx = Math.floor((c.x - COVER_HALF_WIDTH) / TILE_SIZE); tx <= Math.floor((c.x + COVER_HALF_WIDTH) / TILE_SIZE); tx++) {
        for (let ty = Math.floor((c.y - COVER_HALF_HEIGHT) / TILE_SIZE); ty <= Math.floor((c.y + COVER_HALF_HEIGHT) / TILE_SIZE); ty++) {
            if (ty < 0 || ty > maxTile) continue
            const wrappedX = ((tx % (maxTile + 1)) + maxTile + 1) % (maxTile + 1)
            tiles.push({
                key: `${zoom}/${tx}/${ty}`,
                src: `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${ty}.png`,
                left: tx * TILE_SIZE - c.x,
                top: ty * TILE_SIZE - c.y,
            })
        }
    }

    // 強調する印（いちばん近いお店）を最後に描いて前面に出す
    const ordered = [...markers].sort((a, b) => Number(Boolean(a.highlighted)) - Number(Boolean(b.highlighted)))

    return (
        <div className={cn("relative h-52 w-full overflow-hidden bg-muted", className)} role="img" aria-label="現在地と近くのお店の地図">
            {tiles.map((tile) => (
                // eslint-disable-next-line @next/next/no-img-element -- 外部タイルを並べるだけで最適化は不要
                <img
                    key={tile.key}
                    src={tile.src}
                    alt=""
                    width={TILE_SIZE}
                    height={TILE_SIZE}
                    draggable={false}
                    className="pointer-events-none absolute max-w-none select-none"
                    style={{ left: `calc(50% + ${tile.left}px)`, top: `calc(50% + ${tile.top}px)` }}
                />
            ))}
            <span
                aria-hidden
                className="absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white bg-blue-500 shadow-[0_0_0_8px_rgba(59,130,246,0.25)]"
                style={{ left: "50%", top: "50%" }}
            />
            {ordered.map((marker) => {
                const p = project(marker, zoom)
                return (
                    <span
                        key={marker.id}
                        aria-hidden
                        className={cn(
                            "absolute flex items-center justify-center rounded-full rounded-bl-none border-2 border-white font-bold text-white shadow",
                            marker.highlighted ? "size-7 bg-orange-700 text-[13px]" : "size-[22px] bg-neutral-600 text-[11px]"
                        )}
                        // 左下を尖らせた円を-45度回して、尖りが真下（お店の位置）を指すしずく形の印にする
                        style={{
                            left: `calc(50% + ${p.x - c.x}px)`,
                            top: `calc(50% + ${p.y - c.y}px)`,
                            transform: "translate(-50%, -120%) rotate(-45deg)",
                        }}>
                        <span className="block rotate-45 leading-none">{marker.label}</span>
                    </span>
                )
            })}
            <span className="absolute right-1 bottom-0.5 bg-white/75 px-1 text-[9px] text-neutral-700">© OpenStreetMap contributors</span>
        </div>
    )
}
