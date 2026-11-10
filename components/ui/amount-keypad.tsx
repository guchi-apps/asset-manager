"use client"

import * as React from "react"
import { createPortal } from "react-dom"

import { applyKeypadKey, type KeypadOptions } from "@/lib/amount-keypad"
import { cn } from "@/lib/utils"

/** スマホ幅（`useIsMobile` と同じ768px未満）。この幅だけOSキーボードの代わりに専用キーパッドを使う */
const KEYPAD_QUERY = "(max-width: 767px)"

function subscribeViewport(onChange: () => void) {
    const mql = window.matchMedia(KEYPAD_QUERY)
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
}

/**
 * `useIsMobile` は初回描画が false のため、初回タップでOSキーボードが一瞬出うる。
 * こちらは matchMedia を同期で読む（SSR 時だけ false）。
 */
function useKeypadViewport(): boolean {
    return React.useSyncExternalStore(
        subscribeViewport,
        () => window.matchMedia(KEYPAD_QUERY).matches,
        () => false
    )
}

interface AmountKeypadProps extends KeypadOptions {
    onKey: (key: string) => void
    onClose: () => void
}

/** キー配置は 7 8 9 ⌫ / 4 5 6 ± / 1 2 3 完了 / 00 0 . の4×4（完了は2行ぶん） */
function AmountKeypad({ onKey, onClose, allowNegative, allowDecimal }: AmountKeypadProps) {
    const keyClass =
        "h-14 rounded-lg bg-muted text-2xl font-semibold tabular-nums text-foreground select-none touch-manipulation active:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-30"
    // 入力欄からフォーカスを奪わない（奪うとOSキーボードが出る・ダイアログのフォーカストラップが動く）
    const keepFocus = (e: React.SyntheticEvent) => e.preventDefault()

    const key = (value: string, label: React.ReactNode, extra?: { disabled?: boolean; className?: string; ariaLabel?: string }) => (
        <button
            type="button"
            key={value}
            className={cn(keyClass, extra?.className)}
            disabled={extra?.disabled}
            aria-label={extra?.ariaLabel}
            onPointerDown={keepFocus}
            onMouseDown={keepFocus}
            onClick={() => onKey(value)}
        >
            {label}
        </button>
    )

    // 開いている間、実測の高さをCSS変数で共有する（シート・ダイアログがキーパッドの上へ寄る。ui/sheet.tsx・ui/dialog.tsx）
    const padRef = React.useRef<HTMLDivElement>(null)
    React.useLayoutEffect(() => {
        const el = padRef.current
        if (!el) return
        const root = document.documentElement
        const sync = () => root.style.setProperty("--amount-keypad-height", `${el.offsetHeight}px`)
        sync()
        root.setAttribute("data-amount-keypad-open", "")
        const ro = new ResizeObserver(sync)
        ro.observe(el)
        return () => {
            ro.disconnect()
            root.removeAttribute("data-amount-keypad-open")
            root.style.removeProperty("--amount-keypad-height")
        }
    }, [])

    return createPortal(
        <div
            ref={padRef}
            data-amount-keypad=""
            role="group"
            aria-label="金額キーパッド"
            // モーダルの body に付く pointer-events: none を打ち消す
            className="pointer-events-auto fixed inset-x-0 bottom-0 z-[100] grid grid-cols-4 grid-rows-4 gap-1.5 border-t bg-background p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-[0_-4px_16px_rgba(0,0,0,0.12)] md:hidden"
        >
            {key("7", "7")}
            {key("8", "8")}
            {key("9", "9")}
            {key("bs", "⌫", { className: "text-lg text-muted-foreground", ariaLabel: "1文字削除" })}
            {key("4", "4")}
            {key("5", "5")}
            {key("6", "6")}
            {key("sign", "±", {
                disabled: !allowNegative,
                className: cn("text-orange-700 dark:text-orange-400", !allowNegative && "invisible"),
                ariaLabel: "正負を切り替え",
            })}
            {key("1", "1")}
            {key("2", "2")}
            {key("3", "3")}
            <button
                type="button"
                className={cn(keyClass, "row-span-2 h-auto bg-primary text-lg text-primary-foreground active:bg-primary/80")}
                onPointerDown={keepFocus}
                onMouseDown={keepFocus}
                onClick={onClose}
            >
                完了
            </button>
            {key("00", "00")}
            {key("0", "0")}
            {key(".", ".", { disabled: !allowDecimal, className: !allowDecimal ? "invisible" : undefined })}
        </div>,
        document.body
    )
}

interface UseAmountKeypadOptions extends KeypadOptions {
    /** 現在の生の文字列（カンマなし。例: "-1234.5"） */
    getRaw: () => string
    setRaw: (raw: string) => void
}

/**
 * 金額入力欄にスマホ用キーパッドをつなぐ。
 * スマホ幅では欄をタップするとキーパッドが出て、OSキーボードは出ない（`inputMode="none"`）。
 * それ以外の幅では何もせず、`inputMode` は呼び出し側の既定のまま。
 */
function useAmountKeypad({ getRaw, setRaw, allowNegative, allowDecimal }: UseAmountKeypadOptions) {
    const enabled = useKeypadViewport()
    const [open, setOpen] = React.useState(false)
    const inputRef = React.useRef<HTMLInputElement | null>(null)

    const close = React.useCallback(() => {
        setOpen(false)
        inputRef.current?.blur()
    }, [])

    // キーパッドが出ている間にスマホ幅を出たら閉じる
    React.useEffect(() => {
        if (!enabled) setOpen(false)
    }, [enabled])

    // 欄とキーパッドの外をタップしたら閉じる
    React.useEffect(() => {
        if (!open) return
        const onPointerDown = (e: PointerEvent) => {
            const target = e.target as Node | null
            if (target && inputRef.current?.contains(target)) return
            if (target instanceof Element && target.closest("[data-amount-keypad]")) return
            setOpen(false)
        }
        document.addEventListener("pointerdown", onPointerDown)
        return () => document.removeEventListener("pointerdown", onPointerDown)
    }, [open])

    // キーパッドに隠れない位置までスクロールする
    React.useEffect(() => {
        const input = inputRef.current
        if (!open || !input) return
        input.style.scrollMarginBottom = "20rem"
        // シート・ダイアログがキーパッドの上へ寄って高さが決まってから動かす
        const frame = requestAnimationFrame(() => input.scrollIntoView({ block: "nearest" }))
        return () => {
            cancelAnimationFrame(frame)
            input.style.scrollMarginBottom = ""
        }
    }, [open])

    const onKey = (key: string) => setRaw(applyKeypadKey(getRaw(), key, { allowNegative, allowDecimal }))

    return {
        enabled,
        /** 入力欄へ渡す。`onFocus` は呼び出し側のものに続けて呼ぶ */
        inputProps: enabled ? ({ inputMode: "none" } as const) : ({} as const),
        handleFocus: (e: React.FocusEvent<HTMLInputElement>) => {
            inputRef.current = e.currentTarget
            if (enabled) setOpen(true)
        },
        /** 「完了」を使わず外側で閉じたあと、フォーカスが残った欄をもう一度タップしたときに開き直す */
        handleClick: (e: React.MouseEvent<HTMLInputElement>) => {
            inputRef.current = e.currentTarget
            if (enabled) setOpen(true)
        },
        keypad: enabled && open ? <AmountKeypad onKey={onKey} onClose={close} allowNegative={allowNegative} allowDecimal={allowDecimal} /> : null,
    }
}

export { AmountKeypad, useAmountKeypad }
