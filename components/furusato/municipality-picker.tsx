"use client"

import { useState } from "react"
import { createPortal } from "react-dom"
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from "lucide-react"

import { Input } from "@/components/ui/input"
import {
    REGIONS,
    filterMunicipalities,
    findPrefecture,
    findRegion,
    formatMunicipality,
    parseMunicipality,
} from "@/lib/furusato/municipalities"

type Props = {
    /** 現在の自治体名（編集時の初期位置の復元に使う） */
    value: string
    onSelect: (value: string) => void
    onClose: () => void
}

/** 地域 → 都道府県 → 市町村と、狭い範囲へ進んで選ぶ全画面の選択画面。フォームの入力を失わないよう、ルート遷移はしない */
export function MunicipalityPicker({ value, onSelect, onClose }: Props) {
    const initial = parseMunicipality(value)
    const [regionName, setRegionName] = useState<string | null>(initial?.region ?? null)
    const [prefectureName, setPrefectureName] = useState<string | null>(initial?.prefecture ?? null)
    const [query, setQuery] = useState("")

    const region = regionName ? findRegion(regionName) : undefined
    const prefecture = prefectureName ? findPrefecture(prefectureName) : undefined

    const title = prefecture ? prefecture.name : region ? region.name : "自治体を選ぶ"
    const crumbs = ["地域", region?.name, prefecture?.name].filter((c): c is string => Boolean(c))

    function back() {
        if (prefecture) {
            setPrefectureName(null)
            setQuery("")
        } else if (region) {
            setRegionName(null)
        } else {
            onClose()
        }
    }

    const rowClass = "flex w-full items-center justify-between border-b px-4 py-3.5 text-left text-base hover:bg-accent"

    const list = prefecture ? (
        <>
            <div className="px-4 py-2">
                <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="市町村を絞り込む"
                    aria-label="市町村を絞り込む"
                />
            </div>
            {!query.trim() && (
                <button
                    type="button"
                    className={`${rowClass} bg-primary/10 font-medium`}
                    onClick={() => onSelect(formatMunicipality(prefecture.name))}
                >
                    <span>{prefecture.name}に寄付（{prefecture.name}への寄付）</span>
                    <span className="text-sm text-muted-foreground">選択</span>
                </button>
            )}
            {filterMunicipalities(prefecture.municipalities, query).map((name) => (
                <button
                    key={name}
                    type="button"
                    className={rowClass}
                    onClick={() => onSelect(formatMunicipality(prefecture.name, name))}
                >
                    <span>{name}</span>
                    <span className="text-sm text-muted-foreground">選択</span>
                </button>
            ))}
            {query.trim() && filterMunicipalities(prefecture.municipalities, query).length === 0 && (
                <p className="px-4 py-6 text-sm text-muted-foreground">該当する市町村がありません。</p>
            )}
        </>
    ) : region ? (
        region.prefectures.map((p) => (
            <button
                key={p.name}
                type="button"
                className={rowClass}
                onClick={() => {
                    setPrefectureName(p.name)
                    setQuery("")
                }}
            >
                <span>{p.name}</span>
                <span className="flex items-center gap-1 text-sm text-muted-foreground">
                    {p.municipalities.length}市町村
                    <ChevronRightIcon className="size-4" />
                </span>
            </button>
        ))
    ) : (
        REGIONS.map((r) => (
            <button key={r.name} type="button" className={rowClass} onClick={() => setRegionName(r.name)}>
                <span>{r.name}</span>
                <span className="flex items-center gap-1 text-sm text-muted-foreground">
                    {r.prefectures.length === 1 ? "1道" : `${r.prefectures.length}都府県`}
                    <ChevronRightIcon className="size-4" />
                </span>
            </button>
        ))
    )

    return createPortal(
        <div role="dialog" aria-modal="true" aria-label="自治体を選ぶ" className="fixed inset-0 z-[100] flex flex-col bg-background">
            <div className="mx-auto flex h-full w-full max-w-xl flex-col border-x">
                <div className="flex items-center gap-2 border-b px-2 py-2">
                    <button type="button" onClick={back} className="flex items-center gap-1 rounded-md px-2 py-2 text-sm text-primary hover:bg-accent">
                        <ChevronLeftIcon className="size-4" />
                        戻る
                    </button>
                    <h2 className="flex-1 text-center font-semibold">{title}</h2>
                    <button type="button" onClick={onClose} aria-label="閉じる" className="rounded-md p-2 hover:bg-accent">
                        <XIcon className="size-4" />
                    </button>
                </div>
                <p className="border-b px-4 py-2 text-xs text-muted-foreground">
                    {crumbs.map((c, i) => (
                        <span key={c}>
                            {i > 0 && " › "}
                            {i === crumbs.length - 1 ? <b className="text-foreground">{c}</b> : c}
                        </span>
                    ))}
                </p>
                <div className="flex-1 overflow-y-auto pb-24">{list}</div>
            </div>
        </div>,
        document.body,
    )
}
