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
import { AccountKindSettings } from "@/components/receipts/account-kind-settings"
import { SettingsSheetCard } from "@/components/receipts/settings-sheet-card"
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
    /** 「連携の状態」の下に並べる操作。普段は使わない「Zaimのマスタを更新」を置く（#452）。 */
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

            <AccountKindSettings
                reloadKey={accounts.map((account) => account.zaimAccountId + ":" + account.name).join(",")}
            />

            <CopyRulesCard accounts={accounts} zaimConfigured={zaimConfigured} />

            <StatusCard statusItems={statusItems} toolbar={toolbar} />
        </div>
    )
}

/* ───────────────────────── 連携の状態 ───────────────────────── */

function StatusCard({
    statusItems,
    toolbar,
}: {
    statusItems: LinkageSettingsProps["statusItems"]
    toolbar?: React.ReactNode
}) {
    const missing = statusItems.filter((item) => !item.ok)
    const missingLabel =
        missing
            .slice(0, 2)
            .map((item) => item.label)
            .join("・") + (missing.length > 2 ? " ほか" + (missing.length - 2) + "件" : "")

    return (
        <SettingsSheetCard
            title="連携の状態"
            description="すべて揃うと、取り込みからZaimの「反映待ち」登録まで通しで使えます"
            summary={
                <>
                    <Badge variant="secondary" className="tabular-nums">
                        {statusItems.length - missing.length} / {statusItems.length} 項目が済
                    </Badge>
                    {missing.length > 0 && <Badge variant="destructive">未: {missingLabel}</Badge>}
                </>
            }
        >
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {statusItems.map((item) => (
                    <div
                        key={item.label}
                        className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
                    >
                        <div className="min-w-0">
                            <div className="truncate text-sm">{item.label}</div>
                            <div className="truncate text-[11px] text-muted-foreground">{item.hint}</div>
                        </div>
                        <Badge variant={item.ok ? "outline" : "destructive"}>{item.ok ? "済" : "未"}</Badge>
                    </div>
                ))}
            </div>
            {toolbar}
        </SettingsSheetCard>
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
    // スマホのボトムシート。プレビューのダイアログはシートの外に置くため、開く前にシートを閉じる。
    const [sheetOpen, setSheetOpen] = React.useState(false)

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
     *
     * **候補が0件でもプレビューを閉じない**（Issue #379）。以前はトーストを出して閉じていたため、
     * #321で入れた「なぜ0件なのか」の内訳が、**それが必要な場面でだけ表示されない**状態だった
     * （コピー元がスマートレシートのように明細を1件も読めない口座だと、必ずこの経路に入る）。
     */
    const openPreview = async () => {
        setSheetOpen(false)
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

    const enabledRules = rules.filter((rule) => rule.enabled)
    const autoCount = enabledRules.filter((rule) => rule.autoCopy).length
    const manualCount = enabledRules.length - autoCount
    const stoppedCount = rules.length - enabledRules.length
    const summary =
        rules.length === 0 ? (
            <Badge variant="outline">ルールなし</Badge>
        ) : (
            <>
                <Badge variant="secondary" className="tabular-nums">
                    {rules.length} ルール
                </Badge>
                {autoCount > 0 && <Badge className="tabular-nums">自動 {autoCount}</Badge>}
                {manualCount > 0 && (
                    <Badge variant="outline" className="tabular-nums">
                        手動 {manualCount}
                    </Badge>
                )}
                {stoppedCount > 0 && (
                    <Badge variant="outline" className="tabular-nums">
                        停止 {stoppedCount}
                    </Badge>
                )}
            </>
        )

    return (
        <>
            <SettingsSheetCard
                title="口座間で明細を複製する"
                description="コピー元の口座に入った支出を、コピー先の口座へ同じ内容で登録します。複製済みの明細は二度登録しません。"
                summary={summary}
                headerAction={
                    <Button variant="outline" size="sm" onClick={() => setAdding((value) => !value)}>
                        <Plus />
                        ルールを追加
                    </Button>
                }
                open={sheetOpen}
                onOpenChange={setSheetOpen}
            >
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
            </SettingsSheetCard>

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
        </>
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
