"use client"

import * as React from "react"
import { FileUp, Loader2, Undo2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatDate, formatYen } from "@/components/ledger/format"
import { importZaimCsvAction, previewZaimCsvAction, undoImportBatchAction } from "@/app/actions/ledger"
import type { CsvPreview, ImportBatchView } from "@/lib/ledger-sources/csv-service"

/**
 * Zaim CSVからの移行（Issue #820）。ファイルを選ぶ → 下見 → 取り込む。取り込みは単位ごとに取り消せる。
 * 取り込み開始日より前の行だけを取り込み、それ以降は継続取得から取る。
 */
export function CsvImport({ batches, startDate, onChanged }: { batches: ImportBatchView[]; startDate: string | null; onChanged: () => void }) {
    const [file, setFile] = React.useState<File | null>(null)
    const [preview, setPreview] = React.useState<CsvPreview | null>(null)
    const [busy, setBusy] = React.useState<string | null>(null)
    const [confirmUndo, setConfirmUndo] = React.useState<number | null>(null)

    const formData = () => {
        const data = new FormData()
        if (file) data.set("file", file)
        return data
    }

    const runPreview = async (selected: File | null) => {
        setFile(selected)
        setPreview(null)
        if (!selected) return
        setBusy("preview")
        try {
            const data = new FormData()
            data.set("file", selected)
            const result = await previewZaimCsvAction(data)
            if (!result.success) toast.error(result.error)
            else setPreview(result.data)
        } finally {
            setBusy(null)
        }
    }

    const runImport = async () => {
        setBusy("import")
        try {
            const result = await importZaimCsvAction(formData())
            if (!result.success) {
                toast.error(result.error)
                return
            }
            toast.success(`${result.data.created}件の取引を取り込みました`)
            setFile(null)
            setPreview(null)
            onChanged()
        } finally {
            setBusy(null)
        }
    }

    const runUndo = async (batchId: number) => {
        setBusy(`undo:${batchId}`)
        try {
            const result = await undoImportBatchAction(batchId)
            if (!result.success) toast.error(result.error)
            else toast.success("取り込みを取り消しました")
            setConfirmUndo(null)
            onChanged()
        } finally {
            setBusy(null)
        }
    }

    const blocked =
        !preview ||
        preview.missingColumns.length > 0 ||
        preview.alreadyImported ||
        !preview.cutoffDate ||
        preview.entries.expense + preview.entries.income + preview.entries.transfer + preview.entries.adjustment === 0

    return (
        <Card>
            <CardHeader>
                <CardTitle>ZaimのCSVから移行</CardTitle>
                <CardDescription>
                    Zaimの「家計簿のデータをダウンロード」で書き出したCSVを取り込みます。
                    {startDate ? `${formatDate(startDate)} より前の行だけを取り込みます（それ以降は継続取得から取ります）。` : "先に上で「取り込みを始める日」を保存してください。"}
                    品目ごとの行と、カテゴリ・集計の設定をそのまま残します。
                </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 text-sm">
                <div className="flex flex-col gap-1.5">
                    <Label htmlFor="zaim-csv-file">CSVファイル</Label>
                    <Input
                        id="zaim-csv-file"
                        type="file"
                        accept=".csv,text/csv"
                        disabled={busy !== null}
                        onChange={(e) => void runPreview(e.target.files?.[0] ?? null)}
                    />
                </div>
                {busy === "preview" && (
                    <p className="flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="size-4 animate-spin" />
                        読み込んでいます
                    </p>
                )}
                {preview && (
                    <div className="flex flex-col gap-2 rounded-md border p-3">
                        {preview.missingColumns.length > 0 ? (
                            <p className="text-destructive">ZaimのCSVではないようです。足りない列：{preview.missingColumns.join("、")}</p>
                        ) : (
                            <>
                                <p>
                                    {preview.fileName}：{preview.rowCount}行
                                    {preview.dateRange && `（${formatDate(preview.dateRange.from)}〜${formatDate(preview.dateRange.to)}）`}
                                </p>
                                <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-xs">
                                    <dt>取り込む取引</dt>
                                    <dd className="text-right tabular-nums">
                                        支出 {preview.entries.expense}・収入 {preview.entries.income}・振替 {preview.entries.transfer}・残高調整 {preview.entries.adjustment}
                                    </dd>
                                    <dt>集計に含める支出の合計</dt>
                                    <dd className="text-right tabular-nums">{formatYen(preview.expenseTotal)}</dd>
                                    <dt>集計に含めない取引</dt>
                                    <dd className="text-right tabular-nums">{preview.excludedCount}件</dd>
                                    <dt>取り込み開始日以降で取り込まない行</dt>
                                    <dd className="text-right tabular-nums">{preview.afterCutoff}行</dd>
                                    {preview.transferTo > 0 && (
                                        <>
                                            <dt>分類ルールで振替にする支出（投資の積立など）</dt>
                                            <dd className="text-right tabular-nums">{preview.transferTo}件</dd>
                                        </>
                                    )}
                                    {preview.transferIn > 0 && (
                                        <>
                                            <dt>振替の受け側として取り込まない収入</dt>
                                            <dd className="text-right tabular-nums">{preview.transferIn}件</dd>
                                        </>
                                    )}
                                    {preview.duplicates > 0 && (
                                        <>
                                            <dt>取り込み済みと同じで飛ばす取引</dt>
                                            <dd className="text-right tabular-nums">{preview.duplicates}件</dd>
                                        </>
                                    )}
                                </dl>
                                {preview.alreadyImported && <p className="text-destructive">このファイルは取り込み済みです。</p>}
                                {!preview.cutoffDate && <p className="text-destructive">取り込みを始める日が未設定です。</p>}
                                {preview.yearOnly > 0 && (
                                    <p className="text-xs text-muted-foreground">
                                        「年の集計にのみ含める」の行が {preview.yearOnly}件 あります。家計簿では「特別な支出」の印を付けて取り込みます（期間の合計には入れ、月の推移からは外します）。
                                    </p>
                                )}
                                {preview.foreignCurrency > 0 && (
                                    <p className="text-xs text-amber-700 dark:text-amber-400">日本円以外の行が {preview.foreignCurrency}件 あります。金額はCSVの値をそのまま円として取り込みます。</p>
                                )}
                                {(preview.unmappedAccounts.length > 0 || preview.unmappedCategoryPairs > 0) && (
                                    <p className="text-xs text-muted-foreground">
                                        対応がまだ決まっていない口座名 {preview.unmappedAccounts.length}件
                                        {preview.unmappedAccounts.length > 0 && `（${preview.unmappedAccounts.slice(0, 5).join("、")}${preview.unmappedAccounts.length > 5 ? " ほか" : ""}）`}
                                        ・カテゴリ {preview.unmappedCategoryPairs}組。取り込んだあと、下の「口座名の対応」「カテゴリ名の対応」で決めると、まとめて付け直します。
                                    </p>
                                )}
                                {preview.problems.length > 0 && (
                                    <p className="text-xs text-amber-700 dark:text-amber-400">
                                        読めなかった行 {preview.problems.length}件：
                                        {preview.problems.slice(0, 3).map((p) => `${p.line}行目 ${p.reason}`).join("、")}
                                    </p>
                                )}
                                <div>
                                    <Button disabled={blocked || busy !== null} onClick={runImport}>
                                        {busy === "import" ? <Loader2 className="animate-spin" /> : <FileUp />}
                                        取り込む
                                    </Button>
                                </div>
                            </>
                        )}
                    </div>
                )}

                {batches.length > 0 && (
                    <div className="flex flex-col">
                        <span className="text-xs text-muted-foreground">これまでの取り込み</span>
                        {batches.map((b) => (
                            <div key={b.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-2 last:border-b-0">
                                <div className="flex min-w-0 flex-col">
                                    <span className="truncate">{b.fileName}</span>
                                    <span className="text-xs text-muted-foreground">
                                        {new Date(b.createdAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}・取引 {b.entryCount}件・
                                        {formatDate(b.cutoffDate)} より前
                                    </span>
                                </div>
                                {confirmUndo === b.id ? (
                                    <div className="flex gap-1">
                                        <Button size="sm" variant="destructive" disabled={busy !== null} onClick={() => runUndo(b.id)}>
                                            {busy === `undo:${b.id}` && <Loader2 className="animate-spin" />}
                                            取り消す（{b.entryCount}件を削除）
                                        </Button>
                                        <Button size="sm" variant="ghost" onClick={() => setConfirmUndo(null)}>
                                            やめる
                                        </Button>
                                    </div>
                                ) : (
                                    <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => setConfirmUndo(b.id)}>
                                        <Undo2 />
                                        取り消す
                                    </Button>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
