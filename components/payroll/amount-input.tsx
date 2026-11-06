"use client"

import * as React from "react"

import { useAmountKeypad } from "@/components/ui/amount-keypad"
import { Input } from "@/components/ui/input"
import { formatAmountRaw } from "@/lib/amount-keypad"
import { cn } from "@/lib/utils"

function sanitizeRaw(input: string): string {
  let value = input.replace(/[^0-9.-]/g, "")
  const negative = value.startsWith("-")
  value = value.replace(/-/g, "")
  if (negative) value = "-" + value
  const firstDot = value.indexOf(".")
  if (firstDot !== -1) {
    value = value.slice(0, firstDot + 1) + value.slice(firstDot + 1).replace(/\./g, "")
  }
  return value
}

function toDisplay(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return ""
  return formatAmountRaw(String(value))
}

export interface AmountInputProps
  extends Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "type"> {
  value: number | undefined
  onChange: (value: number | undefined) => void
  /** スマホの専用キーパッドに「±」を出す（負の金額を入力できる欄だけ true） */
  allowNegative?: boolean
  /** スマホの専用キーパッドに「.」を出す（既定では出さない） */
  allowDecimal?: boolean
}

function AmountInput({
  value,
  onChange,
  onFocus,
  onBlur,
  onClick,
  className,
  allowNegative,
  allowDecimal,
  ...props
}: AmountInputProps) {
  const [text, setText] = React.useState(() => toDisplay(value))
  const isFocused = React.useRef(false)

  React.useEffect(() => {
    if (!isFocused.current) setText(toDisplay(value))
  }, [value])

  const commitRaw = (raw: string) => {
    setText(formatAmountRaw(raw))
    if (raw === "" || raw === "-") {
      onChange(undefined)
    } else {
      const parsed = Number(raw)
      onChange(Number.isNaN(parsed) ? undefined : parsed)
    }
  }

  const keypad = useAmountKeypad({
    getRaw: () => text.replace(/,/g, ""),
    setRaw: commitRaw,
    allowNegative,
    allowDecimal,
  })

  return (
    <>
      <Input
        {...props}
        type="text"
        inputMode="decimal"
        {...keypad.inputProps}
        className={cn(className, keypad.enabled && text.startsWith("-") && "text-orange-700 dark:text-orange-400")}
        value={text}
        onFocus={(e) => {
          isFocused.current = true
          e.target.select()
          keypad.handleFocus(e)
          onFocus?.(e)
        }}
        onClick={(e) => {
          keypad.handleClick(e)
          onClick?.(e)
        }}
        onChange={(e) => commitRaw(sanitizeRaw(e.target.value))}
        onBlur={(e) => {
          isFocused.current = false
          setText(toDisplay(value))
          onBlur?.(e)
        }}
      />
      {keypad.keypad}
    </>
  )
}

export { AmountInput }
