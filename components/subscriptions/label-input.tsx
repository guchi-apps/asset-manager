"use client"

import * as React from "react"
import { X } from "lucide-react"

import { Input } from "@/components/ui/input"
import { LabelBadge } from "@/components/subscriptions/parts"
import type { LabelView } from "@/lib/subscription-service"
import { pickDefaultLabelColor } from "@/lib/subscription-labels"

/**
 * ラベルの入力欄（Issue #491）。
 *
 * 名前をそのまま持つ。既にあるラベルは候補（datalist）から選べ、無い名前を入れた場合は
 * 保存時に辞書へ登録される。色は名前から決まるので、ここでは選ばせない。
 */
export function LabelInput({
    value,
    onChange,
    suggestions,
    id,
}: {
    value: string[]
    onChange: (next: string[]) => void
    suggestions: LabelView[]
    id: string
}) {
    const [draft, setDraft] = React.useState("")
    const listId = `${id}-suggestions`

    const add = (raw: string) => {
        const name = raw.trim()
        if (!name || value.includes(name)) {
            setDraft("")
            return
        }
        onChange([...value, name])
        setDraft("")
    }

    const colorOf = (name: string) =>
        suggestions.find((suggestion) => suggestion.name === name)?.color ?? pickDefaultLabelColor(name)

    return (
        <div className="flex flex-col gap-2">
            {value.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {value.map((name) => (
                        <span key={name} className="inline-flex items-center gap-1">
                            <LabelBadge label={{ name, color: colorOf(name) }} />
                            <button
                                type="button"
                                aria-label={`${name} を外す`}
                                className="text-muted-foreground hover:text-foreground"
                                onClick={() => onChange(value.filter((item) => item !== name))}
                            >
                                <X className="size-3.5" />
                            </button>
                        </span>
                    ))}
                </div>
            )}
            <Input
                id={id}
                list={listId}
                value={draft}
                placeholder="ラベルを入力してEnter（例: 仕事用）"
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key === "Enter") {
                        // ダイアログのフォームごと送信されないように止める
                        event.preventDefault()
                        add(draft)
                    }
                }}
                onBlur={() => add(draft)}
            />
            <datalist id={listId}>
                {suggestions
                    .filter((suggestion) => !value.includes(suggestion.name))
                    .map((suggestion) => (
                        <option key={suggestion.id} value={suggestion.name} />
                    ))}
            </datalist>
        </div>
    )
}
