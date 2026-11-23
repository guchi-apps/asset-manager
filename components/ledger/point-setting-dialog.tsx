"use client"

import * as React from "react"
import { toast } from "sonner"

import { saveLedgerPointSettingAction } from "@/app/actions/ledger"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { normalizeAccountColor } from "@/lib/ledger-input"
import { ACCOUNT_COLOR_PRESETS } from "@/lib/ledger-filters"
import { DEFAULT_ZAIM_POINT_COLOR, type PointSettingView } from "@/lib/ledger-points"
import { cn } from "@/lib/utils"

/** Zaim由来のポイントの表示名・色・非表示を変えるダイアログ（Issue #1603）。空の表示名・「自動に戻す」で元の見た目に戻る */
export function PointSettingDialog({
    target,
    onClose,
    onSaved,
}: {
    target: { itemKey: string; name: string; setting: PointSettingView | undefined } | null
    onClose: () => void
    onSaved: () => void
}) {
    const [displayName, setDisplayName] = React.useState("")
    const [color, setColor] = React.useState<string | null>(null)
    const [hidden, setHidden] = React.useState(false)
    const [saving, setSaving] = React.useState(false)

    React.useEffect(() => {
        if (!target) return
        setDisplayName(target.setting?.displayName ?? "")
        setColor(target.setting?.color ?? null)
        setHidden(target.setting?.hidden ?? false)
    }, [target])

    const submit = async () => {
        if (!target) return
        setSaving(true)
        const result = await saveLedgerPointSettingAction({ itemKey: target.itemKey, displayName: displayName.trim() || null, color, hidden })
        setSaving(false)
        if (!result.success) {
            toast.error(result.error)
            return
        }
        onSaved()
        onClose()
    }

    const shown = color ?? DEFAULT_ZAIM_POINT_COLOR
    return (
        <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>ポイントを編集</DialogTitle>
                    <DialogDescription>元の名前：{target?.name}（Zaim）</DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="point-setting-name">表示名（空欄で元の名前）</Label>
                        <Input id="point-setting-name" value={displayName} maxLength={32} placeholder={target?.name} onChange={(e) => setDisplayName(e.target.value)} />
                    </div>
                    <div className="flex flex-col gap-2">
                        <Label>色</Label>
                        <div className="grid grid-cols-6 gap-2" role="radiogroup" aria-label="色">
                            {ACCOUNT_COLOR_PRESETS.map((preset) => (
                                <button
                                    key={preset}
                                    type="button"
                                    role="radio"
                                    aria-checked={color === preset}
                                    aria-label={preset}
                                    onClick={() => setColor(preset)}
                                    className={cn(
                                        "size-8 justify-self-center rounded-full transition-shadow",
                                        color === preset ? "ring-2 ring-foreground ring-offset-2 ring-offset-background" : "ring-1 ring-black/15 dark:ring-white/20"
                                    )}
                                    style={{ backgroundColor: preset }}
                                />
                            ))}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <label className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm hover:bg-accent">
                                <input
                                    type="color"
                                    value={shown}
                                    onChange={(e) => setColor(normalizeAccountColor(e.target.value))}
                                    className="size-5 cursor-pointer rounded border-0 bg-transparent p-0"
                                    aria-label="ほかの色を選ぶ"
                                />
                                ほかの色
                            </label>
                            <Button type="button" variant="outline" size="sm" disabled={color == null} onClick={() => setColor(null)}>
                                自動に戻す
                            </Button>
                        </div>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                        <Label htmlFor="point-setting-hidden">非表示にする</Label>
                        <Switch id="point-setting-hidden" checked={hidden} onCheckedChange={setHidden} />
                    </div>
                </div>
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onClose}>
                        キャンセル
                    </Button>
                    <Button type="button" disabled={saving} onClick={submit}>
                        保存
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
