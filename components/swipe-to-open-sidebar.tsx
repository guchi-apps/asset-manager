"use client"

import * as React from "react"

import { useSidebar } from "@/components/ui/sidebar"

// iOSは画面最端（およそ0〜20px）を「戻る」ジェスチャーとして専有するため、
// その領域を避けて少し内側から検知を始める。
const EDGE_START_MIN_X = 20
const EDGE_START_MAX_X = 70
const OPEN_THRESHOLD_X = 60
const CANCEL_THRESHOLD_Y = 40

// グラフの期間ドラッグ用div（`touchAction: "none"`）や横スクロール可能な帯の上から
// スワイプが始まった場合は、そちら側の操作を優先してメニューを開かない。
// `data-slot="chart"` のような名指しの除外は使わない
// （グラフのドラッグ用divの内側は `pointer-events-none` のため、
//   touchstartのtargetはドラッグ用div自身になり、名指しの子孫セレクタでは検出できない）。
function hasSwipeBlockingAncestor(target: EventTarget | null): boolean {
    let el = target instanceof Element ? target : null
    while (el) {
        const style = window.getComputedStyle(el)
        if (style.touchAction === "none") {
            return true
        }
        if (el.scrollWidth > el.clientWidth) {
            return true
        }
        el = el.parentElement
    }
    return false
}

export function SwipeToOpenSidebar() {
    const { isMobile, openMobile, setOpenMobile } = useSidebar()
    const startRef = React.useRef<{ x: number; y: number } | null>(null)

    React.useEffect(() => {
        if (!isMobile || openMobile) {
            return
        }

        const handleTouchStart = (event: TouchEvent) => {
            const touch = event.touches[0]
            if (!touch) {
                return
            }
            if (touch.clientX < EDGE_START_MIN_X || touch.clientX > EDGE_START_MAX_X) {
                return
            }
            if (hasSwipeBlockingAncestor(event.target)) {
                return
            }
            startRef.current = { x: touch.clientX, y: touch.clientY }
        }

        const handleTouchMove = (event: TouchEvent) => {
            const start = startRef.current
            const touch = event.touches[0]
            if (!start || !touch) {
                return
            }

            const dx = touch.clientX - start.x
            const dy = touch.clientY - start.y

            if (Math.abs(dy) > CANCEL_THRESHOLD_Y) {
                startRef.current = null
                return
            }

            if (dx > OPEN_THRESHOLD_X) {
                setOpenMobile(true)
                startRef.current = null
            }
        }

        const handleTouchEndOrCancel = () => {
            startRef.current = null
        }

        document.addEventListener("touchstart", handleTouchStart, { passive: true })
        document.addEventListener("touchmove", handleTouchMove, { passive: true })
        document.addEventListener("touchend", handleTouchEndOrCancel, { passive: true })
        // OS側がジェスチャーを引き取った（画面端の戻る操作など）場合はtouchcancelが飛ぶため、
        // メニューを開かずに追跡を打ち切る。
        document.addEventListener("touchcancel", handleTouchEndOrCancel, { passive: true })

        return () => {
            document.removeEventListener("touchstart", handleTouchStart)
            document.removeEventListener("touchmove", handleTouchMove)
            document.removeEventListener("touchend", handleTouchEndOrCancel)
            document.removeEventListener("touchcancel", handleTouchEndOrCancel)
        }
    }, [isMobile, openMobile, setOpenMobile])

    return null
}
