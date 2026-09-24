"use client"

import * as React from "react"
import { Download, Upload, FileText, CheckCircle2, AlertCircle } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { toast } from "sonner"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { exportAllData, getTemplateCsv, importData, type ImportExistingPolicy } from "../actions/data-management"
import { getCategories } from "../actions/categories"
import { Category } from "@/types/asset"
import { getTodayDateInput } from "@/lib/valuation-day"

export default function DataManagementPage() {
    const [isLoading, setIsLoading] = React.useState(false)
    const fileInputRef = React.useRef<HTMLInputElement>(null)
    const [importResult, setImportResult] = React.useState<{
        success: boolean;
        importedCount?: number;
        errorCount?: number;
        error?: string;
        errors?: string[];
        successDetails?: string[];
    } | null>(null)
    const [categories, setCategories] = React.useState<Category[]>([])
    const [selectedAssetId, setSelectedAssetId] = React.useState<string>("")
    const [existingPolicy, setExistingPolicy] = React.useState<ImportExistingPolicy>("skip")

    React.useEffect(() => {
        getCategories()
            .then(data => setCategories(data || []))
            .catch(err => console.error("Failed to load categories:", err))
    }, [])

    const handleExport = async () => {
        setIsLoading(true)
        try {
            const res = await exportAllData()
            if (res.success && res.csv) {
                // Create download link
                const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), res.csv], { type: 'text/csv;charset=utf-8;' }) // Add BOM for Excel
                const url = URL.createObjectURL(blob)
                const link = document.createElement('a')
                link.href = url
                link.setAttribute('download', `asset_manager_export_${getTodayDateInput()}.csv`)
                document.body.appendChild(link)
                link.click()
                document.body.removeChild(link)
                toast.success("エクスポートしました")
            } else {
                toast.error(res.error || "エクスポートに失敗しました")
            }
        } catch (error) {
            console.error(error)
            toast.error("エラーが発生しました")
        } finally {
            setIsLoading(false)
        }
    }

    const handleDownloadTemplate = async () => {
        try {
            const assetId = selectedAssetId && !isNaN(parseInt(selectedAssetId)) ? parseInt(selectedAssetId) : undefined;

            // Server Action returns raw CSV string
            const csv = await getTemplateCsv(assetId);

            if (!csv) {
                toast.error("テンプレートの生成に失敗しました");
                return;
            }

            const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;

            if (assetId) {
                const assetName = categories.find(c => c.id === assetId)?.name || "asset";
                link.setAttribute('download', `template_${assetName}.csv`);
            } else {
                link.setAttribute('download', 'import_template.csv');
            }

            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } catch (error) {
            console.error(error);
            toast.error("エラーが発生しました");
        }
    }

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        if (!selectedAssetId) {
            toast.error("インポート先の資産を選択してください")
            if (fileInputRef.current) fileInputRef.current.value = ""
            return
        }

        if (!confirm("選択したファイルのデータを追加インポートしますか？")) {
            if (fileInputRef.current) fileInputRef.current.value = ""
            return
        }

        setIsLoading(true)
        setImportResult(null)

        const reader = new FileReader()
        reader.onload = async (event) => {
            const content = event.target?.result as string
            try {
                const res = await importData(content, parseInt(selectedAssetId), existingPolicy)
                setImportResult(res)
                if (res.success) {
                    if (res.errorCount && res.errorCount > 0) {
                        toast.warning(`${res.importedCount}件インポート、${res.errorCount}件のエラーがありました`)
                    } else {
                        toast.success(`${res.importedCount}件のデータをインポートしました`)
                    }
                } else {
                    toast.error(res.error || "インポートに失敗しました")
                }
            } catch (error) {
                console.error(error)
                toast.error("インポート処理中にエラーが発生しました")
            } finally {
                setIsLoading(false)
                if (fileInputRef.current) fileInputRef.current.value = ""
            }
        }
        reader.readAsText(file)
    }

    // Filter only leaf categories (assets that can have transactions)
    const leafCategories = categories.filter(c => !categories.some(child => child.parentId === c.id));

    return (
        <div className="flex flex-col gap-6 px-2 py-4 md:px-4 md:py-8">
            <div className="flex items-center justify-between">
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Download className="h-5 w-5" />
                            データバックアップ (全件)
                        </CardTitle>
                        <CardDescription>
                            登録されている全データをCSV形式で出力します。
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <p className="text-sm text-muted-foreground mb-4">
                            取引履歴、評価額履歴を含むすべてのデータが出力されます。
                        </p>
                        <Button onClick={handleExport} disabled={isLoading} className="w-full">
                            {isLoading ? "処理中..." : "全データをエクスポート"}
                        </Button>
                    </CardContent>
                </Card>

                <Card className="col-span-1 md:col-span-2 lg:col-span-2">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Upload className="h-5 w-5" />
                            一括データ登録 (インポート)
                        </CardTitle>
                        <CardDescription>
                            指定した資産にCSVファイルからデータを一括登録します。
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="grid md:grid-cols-2 gap-6">
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <Label>1. 登録先の資産を選択</Label>
                                    <Select value={selectedAssetId} onValueChange={setSelectedAssetId}>
                                        <SelectTrigger>
                                            <SelectValue placeholder="資産を選択してください" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {leafCategories.map(c => (
                                                <SelectItem key={c.id} value={String(c.id)}>
                                                    {c.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="space-y-2">
                                    <Label>2. テンプレートをダウンロード</Label>
                                    <Button
                                        variant="outline"
                                        onClick={handleDownloadTemplate}
                                        className="w-full"
                                        size="sm"
                                        disabled={!selectedAssetId}
                                    >
                                        <FileText className="mr-2 h-4 w-4" />
                                        {selectedAssetId ? "テンプレートをダウンロード" : "資産を選択してください"}
                                    </Button>
                                    {selectedAssetId && (
                                        <p className="text-xs text-muted-foreground mt-1">
                                            ※ダウンロードされるCSVには、現在の登録データが履歴として含まれます。
                                        </p>
                                    )}
                                </div>

                                <div className="space-y-2">
                                    <Label>3. 評価額がすでにある日の扱い</Label>
                                    <Select value={existingPolicy} onValueChange={(v) => setExistingPolicy(v as ImportExistingPolicy)}>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="skip">スキップする（既存の値を残す）</SelectItem>
                                            <SelectItem value="overwrite">CSVの値で上書きする</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <p className="text-xs text-muted-foreground">
                                        ※Zaimの自動取得や前回のインポートで、同じ日の評価額が二重に登録されるのを防ぎます。
                                    </p>
                                </div>

                                <div className="space-y-2">
                                    <Label>4. CSVファイルをインポート</Label>
                                    <div className="flex gap-2">
                                        <div className="relative flex-1">
                                            <Input
                                                ref={fileInputRef}
                                                type="file"
                                                accept=".csv"
                                                onChange={handleFileChange}
                                                disabled={isLoading || !selectedAssetId}
                                                className="cursor-pointer"
                                            />
                                        </div>
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        ※ダウンロードしたCSVファイルを使用してください。
                                    </p>
                                </div>
                            </div>

                            <div className="bg-muted/30 rounded-lg p-4 text-sm border">
                                <h4 className="font-semibold mb-2 flex items-center gap-2">
                                    <AlertCircle className="h-4 w-4" />
                                    インポート時の注意点
                                </h4>
                                <ul className="list-disc list-inside space-y-1 text-muted-foreground text-xs">
                                    <li>1列目(操作)に <b>I</b> を入れると無視、<b>D</b> を入れると削除、空欄なら新規追加します。</li>
                                    <li>「出金額」と「売却額」はセットで入力が必要です。</li>
                                    <li>未来の日付も登録可能ですが、グラフや残高計算に影響します。</li>
                                    <li>テンプレートの履歴データは自動的に <b>I</b> (無視) が設定されています。</li>
                                    <li>ヘッダー行は自動的にスキップされます。</li>
                                </ul>

                                {importResult && (
                                    <div className={`mt-4 p-4 rounded-md border ${importResult.success ? "bg-green-50/50 border-green-200 text-green-800 dark:bg-green-900/10 dark:border-green-800 dark:text-green-300" : "bg-red-50/50 border-red-200 text-red-800 dark:bg-red-900/10 dark:border-red-800 dark:text-red-300"}`}>
                                        <div className="flex items-center gap-2 font-bold mb-2 text-sm">
                                            {importResult.success ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                                            {importResult.success ? "インポートの結果" : "失敗"}
                                        </div>
                                        {importResult.success ? (
                                            <div className="space-y-3">
                                                <div className="flex gap-4 text-xs font-medium">
                                                    <div className="text-green-700 dark:text-green-400">成功: {importResult.importedCount ?? 0}件</div>
                                                    {(importResult.errorCount ?? 0) > 0 && (
                                                        <div className="text-red-600 dark:text-red-400">失敗/スキップ: {importResult.errorCount}件</div>
                                                    )}
                                                </div>

                                                {importResult.successDetails && importResult.successDetails.length > 0 && (
                                                    <div>
                                                        <div className="text-[10px] uppercase tracking-wider font-bold opacity-60 mb-1">成功したデータ</div>
                                                        <div className="text-xs max-h-40 overflow-y-auto bg-background/40 p-2 rounded-md border border-green-200/50 dark:border-green-800/30 space-y-1">
                                                            {importResult.successDetails.map((detail, i) => (
                                                                <div key={i} className="flex gap-2 text-green-700 dark:text-green-400">
                                                                    <span className="opacity-50">✓</span>
                                                                    {detail}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}

                                                {importResult.errors && importResult.errors.length > 0 && (
                                                    <div>
                                                        <div className="text-[10px] uppercase tracking-wider font-bold opacity-60 mb-1">エラーまたはスキップされた行</div>
                                                        <div className="text-xs max-h-32 overflow-y-auto bg-background/40 p-2 rounded-md border border-red-200/50 dark:border-red-800/30 space-y-1">
                                                            {importResult.errors.map((err, i) => (
                                                                <div key={i} className="text-red-600 dark:text-red-400">× {err}</div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        ) : (
                                            <div className="text-sm">{importResult.error}</div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
