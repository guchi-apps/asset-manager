"use client"

import * as React from "react"
import { CalendarIcon, ChevronRightIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useIsMobile } from "@/hooks/use-mobile"
import { dayToLocalDate, formatDayLabel, formatTime, formatTimeLabel, localDateToDay, parseTime } from "@/lib/date-field"
import { cn } from "@/lib/utils"

export interface DateTimePickerProps {
    id?: string
    /** `YYYY-MM-DD`。空文字は未入力 */
    date: string
    /** `HH` か `HH:mm`。空文字は時刻なし */
    time: string
    onDateChange: (value: string) => void
    onTimeChange: (value: string) => void
    required?: boolean
    disabled?: boolean
    className?: string
}

/**
 * 日付と時刻を1つの欄にまとめた入力（#1369）。開くとまずカレンダーで、その下に時刻の行が出る。
 * 時刻の行を押すとカレンダー部分が時・分の上下スクロール選択に切り替わり、「時刻を設定」で戻る。
 * スマホ（768px未満）は下からのシート、PC・iPad は同じ中身のポップオーバー。
 * 値は文字列のまま受け渡す（`Date` を通した UTC 変換はしない。#443）。
 */
export function DateTimePicker({ id, date, time, onDateChange, onTimeChange, required, disabled, className }: DateTimePickerProps) {
    const isMobile = useIsMobile()
    const [open, setOpen] = React.useState(false)
    const dayLabel = formatDayLabel(date)
    const timeLabel = formatTimeLabel(time)

    const trigger = (
        <Button
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={isMobile ? () => setOpen(true) : undefined}
            className={cn("h-9 w-full min-w-0 justify-start gap-2 px-3 font-normal", !dayLabel && "text-muted-foreground")}
        >
            <CalendarIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">
                {dayLabel || "日付を選ぶ"}
                {timeLabel && <span className="ml-2 tabular-nums">{timeLabel}</span>}
            </span>
        </Button>
    )

    const body = <PickerBody date={date} time={time} onDateChange={onDateChange} onTimeChange={onTimeChange} onDone={() => setOpen(false)} />

    return (
        <div className={cn("relative flex w-full min-w-0 items-center", className)}>
            {isMobile ? (
                <>
                    {trigger}
                    <Sheet open={open} onOpenChange={setOpen}>
                        <SheetContent
                            side="bottom"
                            showCloseButton={false}
                            swipeToClose
                            onOpenAutoFocus={(event) => event.preventDefault()}
                            className="mx-auto max-h-[85dvh] gap-0 overflow-y-auto rounded-t-2xl p-0 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] sm:max-w-xl">
                            <SheetHeader data-sheet-drag-handle className="items-center p-3 pb-0">
                                <div className="bg-muted h-1 w-10 rounded-full" />
                                <SheetTitle className="sr-only">日時を選ぶ</SheetTitle>
                                <SheetDescription className="sr-only">カレンダーで日付を選び、時刻の行から時・分を選びます</SheetDescription>
                            </SheetHeader>
                            {body}
                        </SheetContent>
                    </Sheet>
                </>
            ) : (
                <Popover open={open} onOpenChange={setOpen}>
                    <PopoverTrigger asChild>{trigger}</PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                        {body}
                    </PopoverContent>
                </Popover>
            )}
            {/* ボタンには required が効かないので、値を持つ不可視の input でブラウザの必須検証を残す */}
            {required && (
                <input
                    tabIndex={-1}
                    aria-hidden
                    required
                    value={date}
                    onChange={() => {}}
                    onFocus={() => setOpen(true)}
                    className="pointer-events-none absolute inset-x-0 bottom-0 h-px opacity-0"
                />
            )}
        </div>
    )
}

function PickerBody({
    date,
    time,
    onDateChange,
    onTimeChange,
    onDone,
}: Pick<DateTimePickerProps, "date" | "time" | "onDateChange" | "onTimeChange"> & { onDone: () => void }) {
    const [view, setView] = React.useState<"calendar" | "time">("calendar")
    const [hour, setHour] = React.useState<number | null>(null)
    const [minute, setMinute] = React.useState<number | null>(null)
    const selected = dayToLocalDate(date)

    const openTime = () => {
        const parts = parseTime(time)
        setHour(parts?.hour ?? null)
        setMinute(parts?.minute ?? null)
        setView("time")
    }

    if (view === "time") {
        const commit = (h: number | null, m: number | null) => {
            onTimeChange(h === null ? "" : formatTime({ hour: h, minute: m }))
            setView("calendar")
        }
        return (
            <div className="flex flex-col gap-3 p-4">
                <div className="text-center text-sm font-medium">時刻を選ぶ</div>
                <div className="flex justify-center gap-3">
                    <WheelColumn
                        label="時"
                        unit="時"
                        count={24}
                        value={hour}
                        onChange={(next) => {
                            setHour(next)
                            if (next === null) setMinute(null)
                        }}
                    />
                    <WheelColumn label="分" unit="分" count={60} value={minute} disabled={hour === null} onChange={setMinute} />
                </div>
                <p className="text-muted-foreground text-center text-xs">どちらも「—」で時刻なし、分だけ「—」で時のみ</p>
                <div className="flex gap-2">
                    <Button type="button" variant="outline" className="flex-1" onClick={() => commit(null, null)}>
                        クリア
                    </Button>
                    <Button type="button" className="flex-1" onClick={() => commit(hour, hour === null ? null : minute)}>
                        時刻を設定
                    </Button>
                </div>
            </div>
        )
    }

    return (
        <div className="flex flex-col">
            <Calendar
                mode="single"
                required
                selected={selected}
                defaultMonth={selected}
                onSelect={(next) => {
                    if (next) onDateChange(localDateToDay(next))
                }}
                captionLayout="dropdown"
                startMonth={new Date(2000, 0)}
                endMonth={new Date(new Date().getFullYear() + 10, 11)}
                className="mx-auto"
            />
            <button
                type="button"
                onClick={openTime}
                className="hover:bg-accent mx-3 flex items-center justify-between rounded-md border-t px-2 py-3 text-sm">
                <span>時刻</span>
                <span className="text-muted-foreground flex items-center gap-1 tabular-nums">
                    {formatTimeLabel(time) || "—"}
                    <ChevronRightIcon className="size-4" />
                </span>
            </button>
            <div className="p-3">
                <Button type="button" className="w-full" onClick={onDone}>
                    完了
                </Button>
            </div>
        </div>
    )
}

const ITEM_H = 40
const VISIBLE = 5

/** 上下スクロールで選ぶ列。先頭は「—」（未指定）。中央の行が選択値で、タップでもその行へ寄せる */
function WheelColumn({
    label,
    unit,
    count,
    value,
    disabled,
    onChange,
}: {
    label: string
    unit: string
    count: number
    value: number | null
    disabled?: boolean
    onChange: (value: number | null) => void
}) {
    const ref = React.useRef<HTMLDivElement>(null)
    const timer = React.useRef<number | undefined>(undefined)
    const index = value === null ? 0 : value + 1

    React.useEffect(() => {
        const el = ref.current
        if (el && Math.abs(el.scrollTop - index * ITEM_H) > 1) el.scrollTop = index * ITEM_H
    }, [index])
    React.useEffect(() => () => window.clearTimeout(timer.current), [])

    const settle = () => {
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => {
            const el = ref.current
            if (!el) return
            const next = Math.min(count, Math.max(0, Math.round(el.scrollTop / ITEM_H)))
            if (disabled) {
                el.scrollTop = 0
                return
            }
            onChange(next === 0 ? null : next - 1)
        }, 90)
    }

    const items = ["—", ...Array.from({ length: count }, (_, i) => String(i).padStart(2, "0"))]
    const pad = ((VISIBLE - 1) / 2) * ITEM_H

    return (
        <div className={cn("relative w-24", disabled && "opacity-40")} role="group" aria-label={label}>
            <div className="bg-accent pointer-events-none absolute inset-x-0 rounded-md" style={{ top: pad, height: ITEM_H }} />
            <div
                ref={ref}
                onScroll={settle}
                className="relative snap-y snap-mandatory overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                style={{ height: ITEM_H * VISIBLE }}>
                <div style={{ paddingTop: pad, paddingBottom: pad }}>
                    {items.map((text, i) => (
                        <button
                            key={text}
                            type="button"
                            tabIndex={-1}
                            disabled={disabled}
                            onClick={() => ref.current?.scrollTo({ top: i * ITEM_H, behavior: "smooth" })}
                            className={cn(
                                "block w-full snap-center text-center tabular-nums",
                                i === index ? "text-foreground font-semibold" : "text-muted-foreground"
                            )}
                            style={{ height: ITEM_H }}>
                            {text}
                            {i > 0 && i === index ? ` ${unit}` : ""}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    )
}
