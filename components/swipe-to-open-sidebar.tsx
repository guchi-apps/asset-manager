"use client"

import * as React from "react"

import { useSidebar } from "@/components/ui/sidebar"

// iOSは画面最端（およそ0〜20px）を「戻る」ジェスチャーとして専有するため、
// その領域を避けて少し内側から検知を始める。
const EDGE_START_MIN_X = 20
const EDGE_START_MAX_X = 70
const OPEN_THRESHOLD_X = 60
const CANCEL_THRESHOLD_Y = 40

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
            if ((event.target as HTMLElement | null)?.closest('[data-slot="chart"]')) {
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

        const handleTouchEnd = () => {
            startRef.current = null
        }

        document.addEventListener("touchstart", handleTouchStart, { passive: true })
        document.addEventListener("touchmove", handleTouchMove, { passive: true })
        document.addEventListener("touchend", handleTouchEnd, { passive: true })

        return () => {
            document.removeEventListener("touchstart", handleTouchStart)
            document.removeEventListener("touchmove", handleTouchMove)
            document.removeEventListener("touchend", handleTouchEnd)
        }
    }, [isMobile, openMobile, setOpenMobile])

    return null
}
