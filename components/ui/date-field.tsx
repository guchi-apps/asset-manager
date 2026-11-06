"use client"

import * as React from "react"
import { CalendarIcon, XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { dayToLocalDate, formatDayLabel, localDateToDay, parseDay } from "@/lib/date-field"
import { cn } from "@/lib/utils"

export interface DateFieldProps {
    id?: string
    /** `YYYY-MM-DD`。空文字は未入力 */
    value: string
    onChange: (value: string) => void
    onBlur?: () => void
    /** `YYYY-MM-DD` */
    min?: string
    /** `YYYY-MM-DD` */
    max?: string
    required?: boolean
    disabled?: boolean
    /** 任意項目で、入力済みの値を空に戻せるようにする */
    clearable?: boolean
    placeholder?: string
    className?: string
    "aria-invalid"?: boolean
}

/**
 * 日付欄（#873）。`<input type="date">` は iOS Safari でネイティブ描画になり、高さ・幅が膨らんで
 * 隣の欄と重なる（#440・#525・#872）。ボタン + カレンダーで全画面の見た目を揃える。
 * 値は `YYYY-MM-DD` の文字列のまま受け渡し、`Date` を通した UTC 変換はしない（#443）。
 */
export function DateField({
    id,
    value,
    onChange,
    onBlur,
    min,
    max,
    required,
    disabled,
    clearable,
    placeholder = "日付を選ぶ",
    className,
    "aria-invalid": ariaInvalid,
}: DateFieldProps) {
    const [open, setOpen] = React.useState(false)
    const selected = dayToLocalDate(value)
    const minDate = dayToLocalDate(min)
    const maxDate = dayToLocalDate(max)
    const label = formatDayLabel(value)
    const showClear = clearable && !required && !disabled && !!parseDay(value)

    return (
        <div className={cn("relative flex w-full min-w-0 items-center", className)}>
            <Popover
                open={open}
                onOpenChange={(next) => {
                    setOpen(next)
                    if (!next) onBlur?.()
                }}
            >
                <PopoverTrigger asChild>
                    <Button
                        id={id}
                        type="button"
                        variant="outline"
                        disabled={disabled}
                        aria-invalid={ariaInvalid}
                        className={cn(
                            "h-9 w-full min-w-0 justify-start gap-2 px-3 font-normal",
                            !label && "text-muted-foreground",
                            showClear && "pr-9"
                        )}
                    >
                        <CalendarIcon className="size-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{label || placeholder}</span>
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                        mode="single"
                        required
                        selected={selected}
                        defaultMonth={selected ?? maxDate ?? minDate}
                        disabled={[...(minDate ? [{ before: minDate }] : []), ...(maxDate ? [{ after: maxDate }] : [])]}
                        onSelect={(date) => {
                            if (!date) return
                            onChange(localDateToDay(date))
                            setOpen(false)
                        }}
                        captionLayout="dropdown"
                        startMonth={minDate ?? new Date(2000, 0)}
                        endMonth={maxDate ?? new Date(new Date().getFullYear() + 10, 11)}
                    />
                </PopoverContent>
            </Popover>
            {showClear && (
                <button
                    type="button"
                    aria-label="日付をクリア"
                    className="absolute right-2 flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                    onClick={() => onChange("")}
                >
                    <XIcon className="size-4" />
                </button>
            )}
            {/* ボタンには required が効かないので、値を持つ不可視の input でブラウザの必須検証を残す */}
            {required && (
                <input
                    tabIndex={-1}
                    aria-hidden
                    required
                    value={value}
                    onChange={() => {}}
                    onFocus={() => setOpen(true)}
                    className="pointer-events-none absolute inset-x-0 bottom-0 h-px opacity-0"
                />
            )}
        </div>
    )
}
