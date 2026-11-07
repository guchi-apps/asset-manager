"use client"

import * as React from "react"
import { FileUp, Loader2, Sparkles } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { applyCategoryImportAction, previewCategoryImportAction } from "@/app/actions/ledger"
import type { CategoryImportPreview } from "@/lib/ledger-category-import-service"

const STATUS_LABEL = { new: "新規", changed: "変更", same: "同じ" } as const

/**
 * カテゴリ体系と、Zaimの分類との対応表を一括で読み込む（Issue #833・#1101）。
 * 「おすすめの分類」を下見 → 反映。既にあるカテゴリ・対応は消さない。
 * ボタンと下見パネルは置き場所が違う（ヘッダーとタブの上）ので、2つの要素に分けて返す。
 */
export function useCategoryImport({ onChanged }: { onChanged: () => void }) {
    const [source, setSource] = React.useState<{ label: string; text: string | null } | null>(null)
    const [preview, setPreview] = React.useState<CategoryImportPreview | null>(null)
    const [busy, setBusy] = React.useState<"preview" | "apply" | null>(null)
    const [showAll, setShowAll] = React.useState(false)

    const runPreview = async (next: { label: string; text: string | null }) => {
        setSource(next)
        setPreview(null)
        setShowAll(false)
        setBusy("preview")
        try {
            const result = await previewCategoryImportAction(next.text)
            if (!result.success) toast.error(result.error)
            else setPreview(result.data)
        } finally {
            setBusy(null)
        }
    }

    const runApply = async () => {
        if (!source) return
        setBusy("apply")
        try {
            const result = await applyCategoryImportAction(source.text)
            if (!result.success) {
                toast.error(result.error)
                return
            }
            const { createdCategories, writtenMappings, classifiedLines } = result.data
            toast.success(`カテゴリを${createdCategories}件作り、対応を${writtenMappings}件書きました（品目${classifiedLines}件を分類）`)
            setSource(null)
            setPreview(null)
            onChanged()
        } finally {
            setBusy(null)
        }
    }

    const changes = preview ? preview.mappings.filter((m) => m.status !== "same") : []
    const shown = showAll ? preview?.mappings ?? [] : changes.slice(0, 8)
    const nothingToDo = preview !== null && preview.creates.length === 0 && changes.length === 0 && preview.workUpdates.length === 0

    const trigger = (
        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => runPreview({ label: "おすすめの分類", text: null })}>
            {busy === "preview" ? <Loader2 className="animate-spin" /> : <Sparkles />}
            おすすめの分類をAIに提案してもらう
        </Button>
    )

    const panelNode =
        busy === null && preview === null ? null : (
        <div className="flex flex-col gap-3 text-sm">
            {busy === "preview" && (
                <p className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    読み込んでいます
                </p>
            )}

            {preview && source && (
                <div className="flex flex-col gap-3 rounded-md border p-3">
                    <p className="font-medium">{source.label}</p>
                    {preview.errors.length > 0 ? (
                        <ul className="flex list-disc flex-col gap-1 pl-5 text-destructive">
                            {preview.errors.slice(0, 10).map((e) => (
                                <li key={e}>{e}</li>
                            ))}
                            {preview.errors.length > 10 && <li>ほか {preview.errors.length - 10}件</li>}
                        </ul>
                    ) : (
                        <>
                            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-xs">
                                <dt>作るカテゴリ</dt>
                                <dd className="text-right tabular-nums">{preview.creates.length}件</dd>
                                <dt>既にあるカテゴリ（作らない）</dt>
                                <dd className="text-right tabular-nums">{preview.existingCount}件</dd>
                                <dt>書く対応（新規・変更）</dt>
                                <dd className="text-right tabular-nums">
                                    {preview.mappings.filter((m) => m.status === "new").length}・{preview.mappings.filter((m) => m.status === "changed").length}件
                                </dd>
                                <dt>未分類の品目のうち分類される見込み</dt>
                                <dd className="text-right tabular-nums">{preview.classifiableLines}件</dd>
                                {preview.untouchedMappings > 0 && (
                                    <>
                                        <dt>ファイルに無い既存の対応（そのまま残す）</dt>
                                        <dd className="text-right tabular-nums">{preview.untouchedMappings}件</dd>
                                    </>
                                )}
                            </dl>

                            {preview.creates.length > 0 && (
                                <p className="text-xs text-muted-foreground">
                                    作る: {preview.creates.slice(0, 12).join("、")}
                                    {preview.creates.length > 12 && ` ほか${preview.creates.length - 12}件`}
                                </p>
                            )}

                            {(preview.workCreates.length > 0 || preview.workUpdates.length > 0) && (
                                <p className="text-xs text-muted-foreground">
                                    会社関係にする: {[...preview.workCreates, ...preview.workUpdates].join("、")}
                                </p>
                            )}

                            {shown.length > 0 && (
                                <div className="flex flex-col">
                                    {shown.map((m) => (
                                        <div key={m.source} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b py-1.5 text-xs last:border-b-0">
                                            <span className="min-w-0 flex-1 truncate">{m.source}</span>
                                            <span className="text-muted-foreground">→</span>
                                            <span className="min-w-0 truncate">{m.target}</span>
                                            <Badge variant={m.status === "changed" ? "default" : "outline"}>{STATUS_LABEL[m.status]}</Badge>
                                            {m.previous && <span className="basis-full text-muted-foreground">今は {m.previous}</span>}
                                        </div>
                                    ))}
                                </div>
                            )}
                            {preview.mappings.length > shown.length && (
                                <div>
                                    <Button variant="ghost" size="sm" onClick={() => setShowAll(true)}>
                                        対応を全部見る（{preview.mappings.length}件）
                                    </Button>
                                </div>
                            )}

                            {nothingToDo ? (
                                <p className="text-muted-foreground">反映済みです。作るカテゴリも書き換える対応もありません。</p>
                            ) : (
                                <div>
                                    <Button disabled={busy !== null} onClick={runApply}>
                                        {busy === "apply" ? <Loader2 className="animate-spin" /> : <FileUp />}
                                        反映する
                                    </Button>
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    )

    return { trigger, panel: panelNode }
}
