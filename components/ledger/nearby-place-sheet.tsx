"use client"

import * as React from "react"
import { Loader2, RotateCw } from "lucide-react"

import { NearbyPlaceMap, type NearbyMapMarker } from "@/components/ledger/nearby-place-map"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import type { Coordinates, NearbyPlace } from "@/lib/nearby-places"

type State =
    | { status: "locating" }
    | { status: "searching"; coords: Coordinates }
    | { status: "ready"; coords: Coordinates; places: NearbyPlace[] }
    | { status: "error"; message: string; coords?: Coordinates }

const GEO_ERROR_MESSAGES: Record<number, string> = {
    1: "位置情報が許可されていません。iPhoneの設定で位置情報を許可するか、店名を直接入力してください。",
    2: "現在地を取得できませんでした。電波の良い場所でもう一度お試しいただくか、店名を直接入力してください。",
    3: "現在地の取得に時間がかかっています。もう一度お試しいただくか、店名を直接入力してください。",
}

/**
 * `getCurrentPosition` の `timeout` は許可ダイアログを待つ時間を数えないため、許可が返らないと
 * いつまでも呼び戻されない（#1194 で「検索中…」のまま止まった）。こちらでも上限を設ける
 */
const LOCATE_LIMIT_MS = 15_000
/** サーバー側は Photon 4秒＋予備の Overpass 10秒で諦める。それより少し長く待つ */
const SEARCH_LIMIT_MS = 20_000

function formatDistance(meters: number): string {
    return meters >= 1000 ? `${(meters / 1000).toFixed(1)}km` : `${meters}m`
}

/** 現在地の周辺のお店を地図と一覧で出し、選んだ店名を返すシート（#1171・#1194）。位置情報は保存しない */
export function NearbyPlaceSheet({
    open,
    onOpenChange,
    onPick,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    onPick: (name: string) => void
}) {
    const [state, setState] = React.useState<State>({ status: "locating" })
    const [attempt, setAttempt] = React.useState(0)

    React.useEffect(() => {
        if (!open) return
        let settled = false
        let cancelled = false
        const controller = new AbortController()
        setState({ status: "locating" })

        if (typeof navigator === "undefined" || !navigator.geolocation) {
            setState({ status: "error", message: "この端末では位置情報を使えません。店名を直接入力してください。" })
            return
        }

        const locateTimer = window.setTimeout(() => {
            if (settled || cancelled) return
            settled = true
            setState({ status: "error", message: GEO_ERROR_MESSAGES[3] })
        }, LOCATE_LIMIT_MS)

        const search = async (coords: Coordinates) => {
            setState({ status: "searching", coords })
            const timer = window.setTimeout(() => controller.abort(), SEARCH_LIMIT_MS)
            try {
                const res = await fetch(`/api/places/nearby?lat=${coords.lat}&lon=${coords.lon}`, { cache: "no-store", signal: controller.signal })
                const data = (await res.json().catch(() => null)) as { places?: NearbyPlace[]; error?: string } | null
                if (cancelled) return
                if (!res.ok || !data?.places) {
                    setState({ status: "error", message: `${data?.error ?? "周辺のお店を取得できませんでした"}。店名を直接入力してもかまいません。`, coords })
                    return
                }
                setState({ status: "ready", coords, places: data.places })
            } catch {
                if (!cancelled) setState({ status: "error", message: "お店の検索に失敗しました。もう一度お試しいただくか、店名を直接入力してください。", coords })
            } finally {
                window.clearTimeout(timer)
            }
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                if (settled || cancelled) return
                settled = true
                window.clearTimeout(locateTimer)
                void search({ lat: position.coords.latitude, lon: position.coords.longitude })
            },
            (error) => {
                if (settled || cancelled) return
                settled = true
                window.clearTimeout(locateTimer)
                setState({ status: "error", message: GEO_ERROR_MESSAGES[error.code] ?? GEO_ERROR_MESSAGES[2] })
            },
            { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 }
        )
        return () => {
            cancelled = true
            window.clearTimeout(locateTimer)
            controller.abort()
        }
    }, [open, attempt])

    const pick = (name: string) => {
        onPick(name)
        onOpenChange(false)
    }

    const coords = state.status === "locating" ? undefined : state.coords
    const places = React.useMemo(() => (state.status === "ready" ? state.places : []), [state])
    const [nearest, ...others] = places
    const markers = React.useMemo<NearbyMapMarker[]>(
        () => places.map((place, index) => ({ id: place.id, lat: place.lat, lon: place.lon, label: String(index + 1), highlighted: index === 0 })),
        [places]
    )

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent
                side="bottom"
                swipeToClose
                showCloseButton={false}
                onOpenAutoFocus={(event) => event.preventDefault()}
                className="mx-auto flex max-h-[85dvh] flex-col gap-0 overflow-hidden rounded-t-2xl p-0 sm:max-w-xl">
                <div data-sheet-drag-handle className="touch-none px-4 pt-2 pb-2">
                    <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-border" aria-hidden />
                    <SheetTitle className="text-center text-base">近くのお店</SheetTitle>
                    <SheetDescription className="sr-only">現在地の周辺のお店から選んで、お店・相手へ入力します</SheetDescription>
                </div>

                <div className="shrink-0 border-y border-border">
                    {coords ? (
                        <NearbyPlaceMap center={coords} markers={markers} />
                    ) : (
                        <p className="flex h-52 items-center justify-center gap-2 bg-muted/40 text-sm text-muted-foreground">
                            {state.status === "locating" && <Loader2 className="size-4 animate-spin" aria-hidden />}
                            {state.status === "locating" ? "現在地を取得中…" : "現在地を表示できません"}
                        </p>
                    )}
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                    {state.status === "searching" && (
                        <p className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-muted-foreground">
                            <Loader2 className="size-4 animate-spin" aria-hidden />
                            近くのお店を検索中…
                        </p>
                    )}
                    {state.status === "error" && (
                        <div className="px-4 py-5">
                            <p className="text-sm text-destructive">{state.message}</p>
                            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => setAttempt((n) => n + 1)}>
                                <RotateCw aria-hidden />
                                もう一度探す
                            </Button>
                        </div>
                    )}
                    {state.status === "ready" && !nearest && (
                        <p className="px-4 py-6 text-sm text-muted-foreground">周辺にお店が見つかりませんでした。店名を直接入力してください。</p>
                    )}
                    {nearest && (
                        <button
                            type="button"
                            onClick={() => pick(nearest.name)}
                            className="mx-4 mt-3 mb-1 flex w-[calc(100%-2rem)] items-center gap-3 rounded-xl border border-orange-700 bg-orange-700/10 px-3.5 py-3 text-left active:bg-orange-700/20">
                            <span className="min-w-0 flex-1">
                                <span className="block text-[11px] font-semibold text-orange-600 dark:text-orange-400">いまいるお店？</span>
                                <span className="block truncate text-base font-bold">{nearest.name}</span>
                                <span className="block text-xs text-muted-foreground">
                                    {[nearest.category, formatDistance(nearest.distanceMeters)].filter(Boolean).join("・")}
                                </span>
                            </span>
                            <span className="shrink-0 rounded-lg bg-orange-700 px-3.5 py-2 text-sm font-semibold text-white">これにする</span>
                        </button>
                    )}
                    {others.length > 0 && (
                        <>
                            <p className="px-4 pt-3 pb-1 text-xs text-muted-foreground">近い順</p>
                            <ul className="divide-y divide-border">
                                {others.map((place, index) => (
                                    <li key={place.id}>
                                        <button
                                            type="button"
                                            onClick={() => pick(place.name)}
                                            className="flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left active:bg-muted">
                                            <span
                                                aria-hidden
                                                className="flex size-5 shrink-0 items-center justify-center rounded-full bg-neutral-600 text-[11px] font-bold text-white">
                                                {index + 2}
                                            </span>
                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate text-sm font-medium">{place.name}</span>
                                                {place.category && <span className="block text-xs text-muted-foreground">{place.category}</span>}
                                            </span>
                                            <span className="shrink-0 text-xs text-muted-foreground">{formatDistance(place.distanceMeters)}</span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </>
                    )}
                    <p className="px-4 py-3 text-xs text-muted-foreground">現在地は検索のためだけに使い、保存しません。地図・店舗情報は © OpenStreetMap contributors。</p>
                </div>
            </SheetContent>
        </Sheet>
    )
}
