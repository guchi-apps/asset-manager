"use client"

/**
 * 設定タブ（Issue #271）。
 *
 * 口座間コピーのルールと、Gmailから明細を作る条件をここで登録する。
 * どちらも「登録しただけでは何も起きない」形にしていて、実際にZaimへ書くのは
 * 取り込み・複製のボタンを押したときだけ。
 */

import * as React from "react"
import { Copy, Loader2, Mail, Plus, RefreshCw, Trash2 } from "lucide-react"
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
import {
    deleteCopyRuleAction,
    previewCopyTargetsAction,
    deleteGmailRuleAction,
    getCopyRulesAction,
    getGmailConnectionAction,
    getGmailRulesAction,
    importFromGmailAction,
    runCopyRulesAction,
    saveCopyRuleAction,
    saveGmailRuleAction,
    type CopyRuleRow,
    type GmailRuleRow,
} from "@/app/actions/kakeibo"
// 型だけの参照なのでコンパイル時に消える（サーバー側のコードはクライアントへ入らない）。
import type { CopyPreviewResult, GmailConnectionStatus } from "@/lib/kakeibo-service"

interface LinkageSettingsProps {
    accounts: Array<{ zaimAccountId: number; name: string }>
    zaimConfigured: boolean
    gmailConfigured: boolean
    /** 「Zaimのマスタを更新」「置き換え候補を更新」など、既存の操作をここへ寄せる。 */
    toolbar?: React.ReactNode
    statusItems: Array<{ label: string; ok: boolean; hint: string }>
}

export function LinkageSettings({
    accounts,
    zaimConfigured,
    gmailConfigured,
    toolbar,
    statusItems,
}: LinkageSettingsProps) {
    return (
        <div className="space-y-4">
            <CopyRulesCard accounts={accounts} zaimConfigured={zaimConfigured} />
            <GmailRulesCard gmailConfigured={gmailConfigured} />

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

/* ───────────────────────── Gmail ───────────────────────── */

const EMPTY_GMAIL_FORM = {
    name: "",
    fromQuery: "",
    subjectQuery: "",
    extraQuery: "",
    lookbackDays: 30,
}

function GmailRulesCard({ gmailConfigured }: { gmailConfigured: boolean }) {
    const [rules, setRules] = React.useState<GmailRuleRow[]>([])
    const [connection, setConnection] = React.useState<GmailConnectionStatus | null>(null)
    const [form, setForm] = React.useState(EMPTY_GMAIL_FORM)
    const [adding, setAdding] = React.useState(false)
    const [saving, setSaving] = React.useState(false)
    const [importing, setImporting] = React.useState(false)
    const [checking, setChecking] = React.useState(false)

    const load = React.useCallback(async () => {
        const result = await getGmailRulesAction()
        if (result.success) setRules(result.data)
    }, [])

    React.useEffect(() => {
        void load()
    }, [load])

    const checkConnection = async () => {
        setChecking(true)
        try {
            const result = await getGmailConnectionAction()
            if (!result.success) {
                toast.error(result.error)
                return
            }
            setConnection(result.data)
            if (result.data.error) toast.error(result.data.error)
            else if (result.data.email) toast.success("Gmailに接続できました（" + result.data.email + "）")
        } finally {
            setChecking(false)
        }
    }

    const save = async () => {
        setSaving(true)
        try {
            const result = await saveGmailRuleAction({ ...form, enabled: true })
            if (!result.success) {
                toast.error(result.error)
                return
            }
            toast.success("Gmailの条件を追加しました")
            setForm(EMPTY_GMAIL_FORM)
            setAdding(false)
            await load()
        } finally {
            setSaving(false)
        }
    }

    const toggle = async (rule: GmailRuleRow, enabled: boolean) => {
        const result = await saveGmailRuleAction({
            id: rule.id,
            name: rule.name,
            fromQuery: rule.fromQuery,
            subjectQuery: rule.subjectQuery,
            extraQuery: rule.extraQuery,
            lookbackDays: rule.lookbackDays,
            enabled,
        })
        if (!result.success) {
            toast.error(result.error)
            return
        }
        await load()
    }

    const remove = async (rule: GmailRuleRow) => {
        const result = await deleteGmailRuleAction(rule.id)
        if (!result.success) {
            toast.error(result.error)
            return
        }
        toast.success("Gmailの条件を削除しました")
        await load()
    }

    const runImport = async () => {
        setImporting(true)
        try {
            const result = await importFromGmailAction()
            if (!result.success) {
                toast.error(result.error)
                return
            }
            const { gmail, copy } = result.data
            if (gmail.imported > 0) {
                toast.success(gmail.imported + " 件の明細をメールから作りました。「明細」タブで確認してください。")
            } else if (gmail.scanned === 0) {
                toast.info("新しく取り込むメールはありませんでした")
            } else {
                toast.info(gmail.scanned + " 件を読みましたが、購入のメールは見つかりませんでした")
            }
            if (gmail.failed > 0) {
                toast.error(gmail.failed + " 件の取り込みに失敗しました: " + (gmail.firstError ?? ""))
            }
            if (copy.copied > 0) {
                toast.success("自動コピーで " + copy.copied + " 件を複製しました")
            }
            await load()
        } finally {
            setImporting(false)
        }
    }

    return (
        <Card>
            <CardHeader>
                <div className="flex items-start gap-2">
                    <div className="flex-1">
                        <CardTitle className="text-base">Gmailから明細を作る</CardTitle>
                        <CardDescription>
                            条件に合うメールをAIで読み取り、「明細」タブへ確認待ちとして追加します。
                            メールは読むだけで、既読・ラベル・削除には触れません。
                        </CardDescription>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setAdding((value) => !value)}>
                        <Plus />
                        条件を追加
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="space-y-3">
                {!gmailConfigured && (
                    <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                        GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN が未設定です。
                        <code className="mx-1">npx -y tsx scripts/gmail-oauth.ts</code>
                        で取得して <code>.env</code> に設定すると使えます。
                    </p>
                )}

                {adding && (
                    <div className="space-y-3 rounded-lg border p-3">
                        <div className="space-y-1.5">
                            <Label htmlFor="gmail-name">条件の名前</Label>
                            <Input
                                id="gmail-name"
                                placeholder="三井住友カード 利用通知"
                                value={form.name}
                                onChange={(event) => setForm({ ...form, name: event.target.value })}
                            />
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-1.5">
                                <Label htmlFor="gmail-from">差出人</Label>
                                <Input
                                    id="gmail-from"
                                    placeholder="statement@vpass.ne.jp"
                                    value={form.fromQuery}
                                    onChange={(event) =>
                                        setForm({ ...form, fromQuery: event.target.value })
                                    }
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="gmail-subject">件名</Label>
                                <Input
                                    id="gmail-subject"
                                    placeholder="ご利用のお知らせ"
                                    value={form.subjectQuery}
                                    onChange={(event) =>
                                        setForm({ ...form, subjectQuery: event.target.value })
                                    }
                                />
                            </div>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-1.5">
                                <Label htmlFor="gmail-extra">追加の検索語（任意）</Label>
                                <Input
                                    id="gmail-extra"
                                    placeholder="-カテゴリ:プロモーション"
                                    value={form.extraQuery}
                                    onChange={(event) =>
                                        setForm({ ...form, extraQuery: event.target.value })
                                    }
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="gmail-days">遡る日数</Label>
                                <Input
                                    id="gmail-days"
                                    type="number"
                                    min={1}
                                    max={365}
                                    value={form.lookbackDays}
                                    onChange={(event) =>
                                        setForm({ ...form, lookbackDays: Number(event.target.value) })
                                    }
                                />
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
                        Gmailの条件はまだありません
                    </p>
                )}

                {rules.map((rule) => (
                    <div key={rule.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
                        <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">{rule.name}</div>
                            <div className="truncate font-mono text-[11px] text-muted-foreground">
                                {[
                                    rule.fromQuery && "from:" + rule.fromQuery,
                                    rule.subjectQuery && "subject:" + rule.subjectQuery,
                                    rule.extraQuery,
                                ]
                                    .filter(Boolean)
                                    .join(" ")}
                            </div>
                        </div>
                        <Badge variant="outline">{rule.importedCount}件取込</Badge>
                        <Switch
                            checked={rule.enabled}
                            aria-label={rule.name + " を有効にする"}
                            onCheckedChange={(checked) => void toggle(rule, checked)}
                        />
                        <Button
                            variant="ghost"
                            size="icon"
                            aria-label="条件を削除"
                            onClick={() => void remove(rule)}
                        >
                            <Trash2 />
                        </Button>
                    </div>
                ))}

                <div className="flex flex-wrap items-center gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={runImport}
                        disabled={importing || !gmailConfigured || rules.length === 0}
                    >
                        {importing ? <Loader2 className="animate-spin" /> : <Mail />}
                        Gmailを取り込む
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={checkConnection}
                        disabled={checking || !gmailConfigured}
                    >
                        {checking ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                        接続を確認
                    </Button>
                    {connection?.email && (
                        <Badge variant="outline">接続済み {connection.email}</Badge>
                    )}
                </div>
            </CardContent>
        </Card>
    )
}
