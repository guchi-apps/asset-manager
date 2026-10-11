"use client"

import * as React from "react"

import { Input } from "@/components/ui/input"

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

function formatWithCommas(raw: string): string {
  if (!raw) return raw
  const negative = raw.startsWith("-")
  const unsigned = negative ? raw.slice(1) : raw
  const [intPart, decPart] = unsigned.split(".")
  const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  return (negative ? "-" : "") + formattedInt + (decPart !== undefined ? "." + decPart : "")
}

function toDisplay(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return ""
  return formatWithCommas(String(value))
}

export interface AmountInputProps
  extends Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "type"> {
  value: number | undefined
  onChange: (value: number | undefined) => void
}

function AmountInput({ value, onChange, onFocus, onBlur, ...props }: AmountInputProps) {
  const [text, setText] = React.useState(() => toDisplay(value))
  const isFocused = React.useRef(false)

  React.useEffect(() => {
    if (!isFocused.current) setText(toDisplay(value))
  }, [value])

  return (
    <Input
      {...props}
      type="text"
      inputMode="decimal"
      value={text}
      onFocus={(e) => {
        isFocused.current = true
        e.target.select()
        onFocus?.(e)
      }}
      onChange={(e) => {
        const raw = sanitizeRaw(e.target.value)
        setText(formatWithCommas(raw))
        if (raw === "" || raw === "-") {
          onChange(undefined)
        } else {
          const parsed = Number(raw)
          onChange(Number.isNaN(parsed) ? undefined : parsed)
        }
      }}
      onBlur={(e) => {
        isFocused.current = false
        setText(toDisplay(value))
        onBlur?.(e)
      }}
    />
  )
}

export { AmountInput }
