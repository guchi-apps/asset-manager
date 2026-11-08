"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { LEDGER_OFFSET_LIMIT, monthIndexParts, offsetForMonth, periodMonthIndex } from "@/lib/ledger-period-index"
import { cn } from "@/lib/utils"

const ITEM_HEIGHT = 40
const VISIBLE_ROWS = 5
const PAD = ITEM_HEIGHT * Math.floor(VISIBLE_ROWS / 2)

/** 上下にスクロールして1つ選ぶ列（スクロールスナップ）。止まった位置の項目が選ばれる */
function Wheel({
    items,
    value,
    onChange,
    label,
}: {
    items: { value: number; label: string }[]
    value: number
    onChange: (value: number) => void
    label: string
}) {
    const ref = React.useRef<HTMLDivElement>(null)
    const timer = React.useRef<number | null>(null)
    const index = Math.max(0, items.findIndex((i) => i.value === value))

    // 開いた直後と、外から値が変わったとき（「今期へ」）に位置を合わせる
    React.useLayoutEffect(() => {
        const el = ref.current
        if (el && Math.round(el.scrollTop / ITEM_HEIGHT) !== index) el.scrollTo({ top: index * ITEM_HEIGHT })
    }, [index])

    React.useEffect(() => () => {
        if (timer.current) window.clearTimeout(timer.current)
    }, [])

    const settle = () => {
        const el = ref.current
        if (!el) return
        const i = Math.max(0, Math.min(items.length - 1, Math.round(el.scrollTop / ITEM_HEIGHT)))
        if (items[i].value !== value) onChange(items[i].value)
    }
    const onScroll = () => {
        if (timer.current) window.clearTimeout(timer.current)
        timer.current = window.setTimeout(settle, 80)
    }

    return (
        <div
            ref={ref}
            role="listbox"
            aria-label={label}
            onScroll={onScroll}
            className="h-full flex-1 snap-y snap-mandatory overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            style={{ paddingBlock: PAD }}
        >
            {items.map((item) => {
                const selected = item.value === value
                return (
                    <button
                        key={item.value}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        onClick={() => ref.current?.scrollTo({ top: items.indexOf(item) * ITEM_HEIGHT, behavior: "smooth" })}
                        className={cn(
                            "flex w-full snap-center items-center justify-center tabular-nums transition-colors",
                            selected ? "text-xl font-bold" : "text-base text-muted-foreground"
                        )}
                        style={{ height: ITEM_HEIGHT }}
                    >
                        {item.label}
                    </button>
                )
            })}
        </div>
    )
}

/**
 * 取引明細の期間見出し。タップすると年月を選ぶハーフモーダルが開く（Issue #1219）。
 * 左が年・右が月。選んだ年月は「今日を含む期間からのずれ」にして `onSelect` へ渡す。
 */
export function PeriodPicker({
    period,
    offset,
    onSelect,
    children,
}: {
    period: { start: string; end: string; label: string }
    offset: number
    onSelect: (offset: number) => void
    children: React.ReactNode
}) {
    const [open, setOpen] = React.useState(false)
    const shownIndex = periodMonthIndex(period)
    const currentIndex = shownIndex - offset
    const shown = monthIndexParts(shownIndex)
    const [year, setYear] = React.useState(shown.year)
    const [month, setMonth] = React.useState(shown.month)

    // 給料日区切りは「◯月分」、1日区切り・暦月は「◯月」（見出しと同じ）
    const monthSuffix = period.label.endsWith("分") ? "月分" : "月"
    const currentYear = monthIndexParts(currentIndex).year
    const years = React.useMemo(() => {
        const span = Math.ceil(LEDGER_OFFSET_LIMIT / 12)
        return Array.from({ length: span * 2 + 1 }, (_, i) => {
            const y = currentYear - span + i
            return { value: y, label: `${y}年` }
        })
    }, [currentYear])
    const months = React.useMemo(
        () => Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: `${i + 1}${monthSuffix}` })),
        [monthSuffix]
    )

    const handleOpenChange = (next: boolean) => {
        if (next) {
            setYear(shown.year)
            setMonth(shown.month)
        }
        setOpen(next)
    }
    const go = (target: number) => {
        setOpen(false)
        if (target !== offset) onSelect(target)
    }
    const goToCurrent = () => {
        const c = monthIndexParts(currentIndex)
        setYear(c.year)
        setMonth(c.month)
    }

    return (
        <Sheet open={open} onOpenChange={handleOpenChange}>
            <SheetTrigger asChild>{children}</SheetTrigger>
            <SheetContent
                side="bottom"
                swipeToClose
                showCloseButton={false}
                className="rounded-t-2xl px-5 pb-6 sm:mx-auto sm:max-w-md"
            >
                <div data-sheet-drag-handle className="-mx-5 -mt-1 flex touch-none justify-center pt-3 pb-1">
                    <span className="h-1 w-10 rounded-full bg-border" aria-hidden />
                </div>
                <div className="flex items-center justify-between">
                    <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                        キャンセル
                    </Button>
                    <SheetTitle className="text-base">年月を選択</SheetTitle>
                    <Button type="button" variant="ghost" size="sm" className="text-primary" onClick={goToCurrent}>
                        今期へ
                    </Button>
                </div>
                <SheetDescription className="sr-only">上下にスクロールして年と月を選び、表示するを押します。</SheetDescription>
                <div className="relative mx-auto flex w-full gap-2" style={{ height: ITEM_HEIGHT * VISIBLE_ROWS }}>
                    <div
                        aria-hidden
                        className="pointer-events-none absolute inset-x-0 rounded-lg bg-primary/10"
                        style={{ top: PAD, height: ITEM_HEIGHT }}
                    />
                    <Wheel items={years} value={year} onChange={setYear} label="年" />
                    <Wheel items={months} value={month} onChange={setMonth} label="月" />
                </div>
                <Button type="button" className="w-full" onClick={() => go(offsetForMonth(year, month, currentIndex))}>
                    表示する
                </Button>
            </SheetContent>
        </Sheet>
    )
}
