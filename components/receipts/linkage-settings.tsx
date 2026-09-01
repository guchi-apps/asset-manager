"use client"

/**
 * 設定タブ（Issue #271）。
 *
 * 口座間コピーのルールをここで登録する。「登録しただけでは何も起きない」形にしていて、
 * 実際にZaimへ書くのは複製のボタンを押したときだけ。
 */

import * as React from "react"
import { Copy, Loader2, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { formatJstDate } from "@/components/receipts/receipt-status"
import { CopyPreviewDialog } from "@/components/receipts/copy-preview-dialog"
import { GenreVisibilitySettings } from "@/components/receipts/genre-visibility-settings"
import {
    deleteCopyRuleAction,
    previewCopyTargetsAction,
    getCopyRulesAction,
    runCopyRulesAction,
    saveCopyRuleAction,
    type CopyRuleRow,
} from "@/app/actions/kakeibo"
// 型だけの参照なのでコンパイル時に消える（サーバー側のコードはクライアントへ入らない）。
import type { CopyPreviewResult } from "@/lib/kakeibo-service"

interface LinkageSettingsProps {
    accounts: Array<{ zaimAccountId: number; name: string }>
    zaimConfigured: boolean
    /** 「Zaimのマスタを更新」「置き換え候補を更新」など、既存の操作をここへ寄せる。 */
    toolbar?: React.ReactNode
    statusItems: Array<{ label: string; ok: boolean; hint: string }>
}

export function LinkageSettings({
    accounts,
    zaimConfigured,
    toolbar,
    statusItems,
}: LinkageSettingsProps) {
    return (
        <div className="space-y-4">
            <GenreVisibilitySettings zaimConfigured={zaimConfigured} />

            <CopyRulesCard accounts={accounts} zaimConfigured={zaimConfigured} />

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">連携の状態</CardTitle>
                    <CardDescription>
                        すべて揃うと、取り込みからZaimの「反映待ち」登録まで通しで使えます
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {statusItems.map((item) => (
                            <div
                                key={item.label}
                                className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
                            >
                                <div className="min-w-0">
                                    <div className="truncate text-sm">{item.label}</div>
                                    <div className="truncate text-[11px] text-muted-foreground">
                                        {item.hint}
                                    </div>
                                </div>
                                <Badge variant={item.ok ? "outline" : "destructive"}>
                                    {item.ok ? "済" : "未"}
                                </Badge>
                            </div>
                        ))}
                    </div>
                    {toolbar}
                </CardContent>
            </Card>
        </div>
    )
}

/* ───────────────────────── 口座間コピー ───────────────────────── */

const EMPTY_COPY_FORM = {
    fromAccountId: 0,
    toAccountId: 0,
    lookbackDays: 60,
    autoCopy: false,
}

function CopyRulesCard({
    accounts,
    zaimConfigured,
}: {
    accounts: Array<{ zaimAccountId: number; name: string }>
    zaimConfigured: boolean
}) {
    const [rules, setRules] = React.useState<CopyRuleRow[]>([])
    const [form, setForm] = React.useState(EMPTY_COPY_FORM)
    const [adding, setAdding] = React.useState(false)
    const [saving, setSaving] = React.useState(false)
    const [running, setRunning] = React.useState(false)
    const [previewing, setPreviewing] = React.useState(false)
    const [previewOpen, setPreviewOpen] = React.useState(false)
    const [preview, setPreview] = React.useState<CopyPreviewResult | null>(null)

    const load = React.useCallback(async () => {
        const result = await getCopyRulesAction()
        if (result.success) setRules(result.data)
    }, [])

    React.useEffect(() => {
        void load()
    }, [load])

    const save = async () => {
        setSaving(true)
        try {
            const result = await saveCopyRuleAction({ ...form, enabled: true })
            if (!result.success) {
                toast.error(result.error)
                return
            }
            toast.success("コピールールを追加しました")
            setForm(EMPTY_COPY_FORM)
            setAdding(false)
            await load()
        } finally {
            setSaving(false)
        }
    }

    const toggle = async (rule: CopyRuleRow, patch: Partial<CopyRuleRow>) => {
        const result = await saveCopyRuleAction({
            id: rule.id,
            fromAccountId: rule.fromAccountId,
            toAccountId: rule.toAccountId,
            lookbackDays: rule.lookbackDays,
            enabled: patch.enabled ?? rule.enabled,
            autoCopy: patch.autoCopy ?? rule.autoCopy,
        })
        if (!result.success) {
            toast.error(result.error)
            return
        }
        await load()
    }

    const remove = async (rule: CopyRuleRow) => {
        const result = await deleteCopyRuleAction(rule.id)
        if (!result.success) {
            toast.error(result.error)
            return
        }
        toast.success("コピールールを削除しました")
        await load()
    }

    /**
     * 複製の対象を読み込んでプレビューを開く（Issue #286）。
     *
     * ここではZaimに何も書き込まない。書き込むのは一覧を確認して `run` を押したときだけ。
     */
    const openPreview = async () => {
        setPreviewing(true)
        setPreview(null)
        setPreviewOpen(true)
        try {
            const result = await previewCopyTargetsAction()
            if (!result.success) {
                setPreviewOpen(false)
                toast.error(result.error)
                return
            }
            if (result.data.entries.length === 0) {
                setPreviewOpen(false)
                toast.info("新しく複製する明細はありませんでした")
                return
            }
            setPreview(result.data)
        } finally {
            setPreviewing(false)
        }
    }

    const run = async (skipMoneyIds: number[]) => {
        setRunning(true)
        try {
            const result = await runCopyRulesAction({ skipMoneyIds })
            if (!result.success) {
                toast.error(result.error)
                return
            }
            const { copied, skipped, excluded, failed, firstError } = result.data
            if (copied > 0) toast.success(copied + " 件をコピー先の口座へ複製しました")
            if (copied === 0 && failed === 0) toast.info("新しく複製する明細はありませんでした")
            if (excluded > 0) toast.info(excluded + " 件は選択から外したため複製していません")
            if (skipped > 0) {
                toast.info(skipped + " 件は内訳が決まっていないため複製していません")
            }
            if (failed > 0) toast.error(failed + " 件の複製に失敗しました: " + (firstError ?? ""))
            setPreviewOpen(false)
            setPreview(null)
            await load()
        } finally {
            setRunning(false)
        }
    }

    return (
        <Card>
            <CardHeader>
                <div className="flex items-start gap-2">
                    <div className="flex-1">
                        <CardTitle className="text-base">口座間で明細を複製する</CardTitle>
                        <CardDescription>
                            コピー元の口座に入った支出を、コピー先の口座へ同じ内容で登録します。
                            複製済みの明細は二度登録しません。
                        </CardDescription>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setAdding((value) => !value)}>
                        <Plus />
                        ルールを追加
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="space-y-3">
                {adding && (
                    <div className="space-y-3 rounded-lg border p-3">
                        <div className="grid gap-3 sm:grid-cols-2">
                            <AccountSelect
                                id="copy-from"
                                label="コピー元の口座"
                                accounts={accounts}
                                value={form.fromAccountId}
                                onChange={(value) => setForm({ ...form, fromAccountId: value })}
                            />
                            <AccountSelect
                                id="copy-to"
                                label="コピー先の口座"
                                accounts={accounts}
                                value={form.toAccountId}
                                onChange={(value) => setForm({ ...form, toAccountId: value })}
                            />
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-1.5">
                                <Label htmlFor="copy-days">遡る日数</Label>
                                <Input
                                    id="copy-days"
                                    type="number"
                                    min={1}
                                    max={365}
                                    value={form.lookbackDays}
                                    onChange={(event) =>
                                        setForm({ ...form, lookbackDays: Number(event.target.value) })
                                    }
                                />
                            </div>
                            <div className="flex items-end gap-2 pb-1">
                                <Switch
                                    id="copy-auto"
                                    checked={form.autoCopy}
                                    onCheckedChange={(checked) =>
                                        setForm({ ...form, autoCopy: checked })
                                    }
                                />
                                <Label htmlFor="copy-auto" className="text-sm font-normal">
                                    取り込みのあとに自動で複製する
                                </Label>
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <Button size="sm" onClick={save} disabled={saving}>
                                {saving && <Loader2 className="animate-spin" />}
                                保存
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
                                やめる
                            </Button>
                        </div>
                    </div>
                )}

                {rules.length === 0 && !adding && (
                    <p className="py-4 text-center text-sm text-muted-foreground">
                        コピーのルールはまだありません
                    </p>
                )}

                {rules.map((rule) => (
                    <div key={rule.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
                        <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                                <Badge variant="secondary">{rule.fromAccountName}</Badge>
                                <span className="text-muted-foreground">→</span>
                                <Badge variant="secondary">{rule.toAccountName}</Badge>
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                                直近{rule.lookbackDays}日・複製 {rule.copiedCount} 件
                                {rule.lastRunAt ? "（最終 " + formatJstDate(rule.lastRunAt, true) + "）" : ""}
                            </div>
                        </div>
                        <Badge variant={rule.autoCopy ? "default" : "outline"}>
                            {rule.autoCopy ? "自動" : "手動"}
                        </Badge>
                        <Switch
                            checked={rule.enabled}
                            aria-label={rule.fromAccountName + "からのコピーを有効にする"}
                            onCheckedChange={(checked) => void toggle(rule, { enabled: checked })}
                        />
                        <Button
                            variant="ghost"
                            size="icon"
                            aria-label="ルールを削除"
                            onClick={() => void remove(rule)}
                        >
                            <Trash2 />
                        </Button>
                    </div>
                ))}

                <Button
                    variant="outline"
                    size="sm"
                    onClick={openPreview}
                    disabled={previewing || running || !zaimConfigured || rules.length === 0}
                >
                    {previewing ? <Loader2 className="animate-spin" /> : <Copy />}
                    いま複製する
                </Button>

                <CopyPreviewDialog
                    open={previewOpen}
                    onOpenChange={(open) => {
                        // 実行中に閉じられると結果の通知先が消えるので、そのあいだは閉じさせない。
                        if (running) return
                        setPreviewOpen(open)
                        if (!open) setPreview(null)
                    }}
                    preview={preview}
                    running={running}
                    onRun={(skipMoneyIds) => void run(skipMoneyIds)}
                />
            </CardContent>
        </Card>
    )
}

function AccountSelect({
    id,
    label,
    accounts,
    value,
    onChange,
}: {
    id: string
    label: string
    accounts: Array<{ zaimAccountId: number; name: string }>
    value: number
    onChange: (value: number) => void
}) {
    return (
        <div className="space-y-1.5">
            <Label htmlFor={id}>{label}</Label>
            <Select
                value={value ? String(value) : undefined}
                onValueChange={(next) => onChange(Number(next))}
            >
                <SelectTrigger id={id} className="w-full">
                    <SelectValue placeholder="口座を選んでください" />
                </SelectTrigger>
                <SelectContent>
                    {accounts.map((account) => (
                        <SelectItem key={account.zaimAccountId} value={String(account.zaimAccountId)}>
                            {account.name}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    )
}
