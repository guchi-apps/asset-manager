"use client"

import * as React from "react"

import { useAmountKeypad } from "@/components/ui/amount-keypad"
import { Input } from "@/components/ui/input"
import { formatAmountRaw } from "@/lib/amount-keypad"
import { cn } from "@/lib/utils"

function toRawValue(input: string): string {
    let value = input.replace(/[^\d.-]/g, "")

    const isNegative = value.startsWith("-")
    value = value.replace(/-/g, "")

    const firstDot = value.indexOf(".")
    if (firstDot !== -1) {
        value = value.slice(0, firstDot + 1) + value.slice(firstDot + 1).replace(/\./g, "")
    }

    return (isNegative ? "-" : "") + value
}

interface CurrencyInputProps
    extends Omit<React.ComponentProps<"input">, "value" | "onChange" | "type"> {
    value?: string | number
    onChange?: (value: string) => void
    /** スマホの専用キーパッドに「±」を出す（負の金額を入力できる欄だけ true） */
    allowNegative?: boolean
    /** スマホの専用キーパッドに「.」を出す */
    allowDecimal?: boolean
}

const CurrencyInput = React.forwardRef<HTMLInputElement, CurrencyInputProps>(
    ({ value, onChange, allowNegative, allowDecimal, className, onFocus, onClick, ...props }, ref) => {
        const rawValue = value === undefined || value === null ? "" : String(value)
        const keypad = useAmountKeypad({
            getRaw: () => rawValue,
            setRaw: (raw) => onChange?.(raw),
            allowNegative,
            allowDecimal,
        })

        return (
            <>
                <Input
                    {...props}
                    ref={ref}
                    type="text"
                    inputMode="decimal"
                    {...keypad.inputProps}
                    className={cn(className, keypad.enabled && rawValue.startsWith("-") && "text-orange-700 dark:text-orange-400")}
                    value={formatAmountRaw(rawValue)}
                    onChange={(e) => onChange?.(toRawValue(e.target.value))}
                    onFocus={(e) => {
                        keypad.handleFocus(e)
                        onFocus?.(e)
                    }}
                    onClick={(e) => {
                        keypad.handleClick(e)
                        onClick?.(e)
                    }}
                />
                {keypad.keypad}
            </>
        )
    }
)
CurrencyInput.displayName = "CurrencyInput"

export { CurrencyInput }
