"use client"

import * as React from "react"
import { Loader2, MapPin } from "lucide-react"

import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { roundCoordinate, type NearbyPlace } from "@/lib/nearby-places"

type State =
    | { status: "loading" }
    | { status: "ready"; places: NearbyPlace[]; lat: number; lon: number }
    | { status: "error"; message: string; coords?: { lat: number; lon: number } }

const GEO_ERROR_MESSAGES: Record<number, string> = {
    1: "位置情報が許可されていません。iPhoneの設定で位置情報を許可するか、店名を直接入力してください。",
    2: "現在地を取得できませんでした。電波の良い場所でもう一度お試しいただくか、店名を直接入力してください。",
    3: "現在地の取得に時間がかかっています。もう一度お試しいただくか、店名を直接入力してください。",
}

function formatDistance(meters: number): string {
    return meters >= 1000 ? `${(meters / 1000).toFixed(1)}km` : `${meters}m`
}

/** 現在地の周辺のお店を地図と一覧で出し、選んだ店名を返すシート（#1171）。位置情報は保存しない */
export function NearbyPlaceSheet({
    open,
    onOpenChange,
    onPick,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    onPick: (name: string) => void
}) {
    const [state, setState] = React.useState<State>({ status: "loading" })

    React.useEffect(() => {
        if (!open) return
        let cancelled = false
        setState({ status: "loading" })

        if (typeof navigator === "undefined" || !navigator.geolocation) {
            setState({ status: "error", message: "この端末では位置情報を使えません。店名を直接入力してください。" })
            return
        }

        navigator.geolocation.getCurrentPosition(
            async (position) => {
                const coords = { lat: position.coords.latitude, lon: position.coords.longitude }
                try {
                    const res = await fetch(`/api/places/nearby?lat=${coords.lat}&lon=${coords.lon}`, { cache: "no-store" })
                    const data = (await res.json().catch(() => null)) as { places?: NearbyPlace[]; error?: string } | null
                    if (cancelled) return
                    if (!res.ok || !data?.places) {
                        setState({ status: "error", message: `${data?.error ?? "周辺のお店を取得できませんでした"}。店名を直接入力してもかまいません。`, coords })
                        return
                    }
                    setState({ status: "ready", places: data.places, lat: coords.lat, lon: coords.lon })
                } catch {
                    if (!cancelled) setState({ status: "error", message: "通信に失敗しました。店名を直接入力してもかまいません。", coords })
                }
            },
            (error) => {
                if (!cancelled) setState({ status: "error", message: GEO_ERROR_MESSAGES[error.code] ?? GEO_ERROR_MESSAGES[2] })
            },
            { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 }
        )
        return () => {
            cancelled = true
        }
    }, [open])

    const coords = state.status === "ready" ? state : state.status === "error" ? state.coords : undefined
    const mapSrc = coords
        ? (() => {
              const lat = roundCoordinate(coords.lat)
              const lon = roundCoordinate(coords.lon)
              const d = 0.004
              return `https://www.openstreetmap.org/export/embed.html?bbox=${lon - d},${lat - d},${lon + d},${lat + d}&layer=mapnik&marker=${lat},${lon}`
          })()
        : null

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

                {mapSrc && (
                    <iframe
                        title="現在地の地図"
                        src={mapSrc}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        className="h-48 w-full shrink-0 border-y border-border"
                    />
                )}

                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                    {state.status === "loading" && (
                        <p className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-muted-foreground">
                            <Loader2 className="size-4 animate-spin" aria-hidden />
                            近くのお店を検索中…
                        </p>
                    )}
                    {state.status === "error" && <p className="px-4 py-6 text-sm text-destructive">{state.message}</p>}
                    {state.status === "ready" && state.places.length === 0 && (
                        <p className="px-4 py-6 text-sm text-muted-foreground">周辺にお店が見つかりませんでした。店名を直接入力してください。</p>
                    )}
                    {state.status === "ready" && state.places.length > 0 && (
                        <ul className="divide-y divide-border">
                            {state.places.map((place) => (
                                <li key={place.id}>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            onPick(place.name)
                                            onOpenChange(false)
                                        }}
                                        className="flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left active:bg-muted">
                                        <MapPin className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-sm font-medium">{place.name}</span>
                                            {place.category && <span className="block text-xs text-muted-foreground">{place.category}</span>}
                                        </span>
                                        <span className="shrink-0 text-xs text-muted-foreground">{formatDistance(place.distanceMeters)}</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                    <p className="px-4 py-3 text-xs text-muted-foreground">現在地は検索のためだけに使い、保存しません。地図・店舗情報は © OpenStreetMap contributors。</p>
                </div>
            </SheetContent>
        </Sheet>
    )
}
