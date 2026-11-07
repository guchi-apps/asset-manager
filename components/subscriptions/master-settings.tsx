"use client"

import * as React from "react"
import { GripVertical, Loader2, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import {
    DndContext,
    KeyboardSensor,
    PointerSensor,
    closestCenter,
    useSensor,
    useSensors,
    type DragEndEvent,
} from "@dnd-kit/core"
import {
    SortableContext,
    arrayMove,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ChoiceDialog } from "@/components/subscriptions/payment-method-picker"
import { LABEL_COLOR_PALETTE } from "@/lib/subscription-labels"
import type { LabelView, LedgerAccountChoice, PaymentMethodView } from "@/lib/subscription-service"
import {
    createLabelAction,
    createPaymentMethodAction,
    deleteLabelAction,
    deletePaymentMethodAction,
    reorderPaymentMethodsAction,
    setPaymentMethodAccountLinkAction,
    updateLabelAction,
    updatePaymentMethodAction,
} from "@/app/actions/subscriptions"

/**
 * 支払い方法とラベルの管理（Issue #491）。
 *
 * 設定を別ページに散らさず、資産管理画面の「カテゴリ／タグ」と同じくサブスク画面のタブに置く。
 */

function useToastedAction(onChanged: () => void) {
    const [pendingId, setPendingId] = React.useState<string | null>(null)

    const runAction = async (
        key: string,
        action: () => Promise<{ success: boolean; error?: string }>,
        successMessage?: string
    ) => {
        setPendingId(key)
        try {
            const result = await action()
            if (!result.success) {
                toast.error(result.error ?? "操作に失敗しました")
                return false
            }
            if (successMessage) toast.success(successMessage)
            onChanged()
            return true
        } finally {
            setPendingId(null)
        }
    }

    return { pendingId, runAction }
}

function SortableRow({ id, children }: { id: number; children: React.ReactNode }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
    return (
        <div
            ref={setNodeRef}
            style={{
                transform: CSS.Transform.toString(transform),
                transition,
                zIndex: isDragging ? 50 : "auto",
                opacity: isDragging ? 0.5 : 1,
            }}
            className="flex items-center gap-2 border-b py-2 last:border-b-0"
        >
            <button
                type="button"
                aria-label="並び替え"
                className="cursor-grab text-muted-foreground active:cursor-grabbing"
                {...attributes}
                {...listeners}
            >
                <GripVertical className="size-4" />
            </button>
            {children}
        </div>
    )
}

export function MasterSettings({
    paymentMethods,
    ledgerAccounts,
    labels,
    onChanged,
}: {
    paymentMethods: PaymentMethodView[]
    ledgerAccounts: LedgerAccountChoice[]
    labels: LabelView[]
    onChanged: () => void
}) {
    return (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <PaymentMethodPanel paymentMethods={paymentMethods} ledgerAccounts={ledgerAccounts} onChanged={onChanged} />
            <LabelPanel labels={labels} onChanged={onChanged} />
        </div>
    )
}

/**
 * 口座を決めていない旧来の支払い方法に、引き落とし先を決めるボタン（Issue #566・#878・#985）。
 * 口座を選ぶと、その口座の支払い方法へ履歴が移ってこの行は無くなる。口座を通らないものは「口座なし」として残る。
 */
function LegacyAccountButton({
    method,
    ledgerAccounts,
    disabled,
    onPick,
}: {
    method: PaymentMethodView
    ledgerAccounts: LedgerAccountChoice[]
    disabled: boolean
    onPick: (value: string) => void
}) {
    const [open, setOpen] = React.useState(false)
    return (
        <>
            <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => setOpen(true)}
                className="h-7 w-fit border-amber-500/60 px-2 text-xs text-amber-700 dark:text-amber-400"
            >
                口座を選ぶ
            </Button>
            <ChoiceDialog
                open={open}
                onOpenChange={setOpen}
                title={`「${method.name}」の引き落とし先`}
                description="選んだ口座の支払い方法へ、このサブスクの履歴をまとめます。"
                groups={[
                    {
                        label: "家計簿の口座",
                        items: ledgerAccounts.map((account) => ({
                            value: String(account.ledgerAccountId),
                            label: account.name,
                        })),
                    },
                    { label: "口座を通らない", items: [{ value: "none", label: "口座なし（給与天引き・請求書など）" }] },
                ]}
                value=""
                onPick={(value) => {
                    setOpen(false)
                    onPick(value)
                }}
            />
        </>
    )
}

function PaymentMethodPanel({
    paymentMethods,
    ledgerAccounts,
    onChanged,
}: {
    paymentMethods: PaymentMethodView[]
    ledgerAccounts: LedgerAccountChoice[]
    onChanged: () => void
}) {
    const { pendingId, runAction } = useToastedAction(onChanged)
    const [order, setOrder] = React.useState(paymentMethods)
    const [newName, setNewName] = React.useState("")
    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    )

    React.useEffect(() => setOrder(paymentMethods), [paymentMethods])

    const unsetCount = paymentMethods.filter((method) => method.accountLink.status === "UNSET").length

    const handleDragEnd = async (event: DragEndEvent) => {
        const { active, over } = event
        if (!over || active.id === over.id) return

        const oldIndex = order.findIndex((method) => method.id === active.id)
        const newIndex = order.findIndex((method) => method.id === over.id)
        const next = arrayMove(order, oldIndex, newIndex)
        // 保存を待つ間もドラッグ結果を見せたいので、先に手元の並びを入れ替える
        setOrder(next)
        await runAction(
            "reorder",
            () => reorderPaymentMethodsAction(next.map((method) => method.id)),
            "並び順を保存しました"
        )
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">支払い方法</CardTitle>
                <CardDescription>
                    サブスクの登録で選べる選択肢です。家計簿の口座は自動で並びます（名前は家計簿の口座で変えます）。
                    請求書払い・給与天引きなど、口座を通らないものだけここで追加・改名できます。
                </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
                {ledgerAccounts.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                        家計簿の口座がありません。先に家計簿で口座を登録してください。
                    </p>
                )}
                {unsetCount > 0 && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                        引き落とし先の口座が未設定の支払い方法が{unsetCount}件あります。「口座を選ぶ」で口座へまとめてください。
                    </p>
                )}
                {order.length === 0 ? (
                    <p className="text-sm text-muted-foreground">まだ支払い方法がありません。</p>
                ) : (
                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                        <SortableContext
                            items={order.map((method) => method.id)}
                            strategy={verticalListSortingStrategy}
                        >
                            <div className="flex flex-col">
                                {order.map((method) => (
                                    <SortableRow key={method.id} id={method.id}>
                                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                                            {method.accountLink.status === "LINKED" ? (
                                                <span
                                                    id={`payment-method-${method.id}`}
                                                    className="truncate px-3 py-1 text-sm"
                                                >
                                                    {method.name}
                                                    {!method.isActive && method.accountLink.ledgerAccountActive === false && (
                                                        <span className="ml-1 text-xs text-muted-foreground">（非表示の口座）</span>
                                                    )}
                                                </span>
                                            ) : (
                                                <Input
                                                    id={`payment-method-${method.id}`}
                                                    defaultValue={method.name}
                                                    maxLength={50}
                                                    className="h-8 border-transparent bg-transparent shadow-none focus-visible:border-input"
                                                    onBlur={(event) => {
                                                        const name = event.target.value.trim()
                                                        if (!name || name === method.name) {
                                                            event.target.value = method.name
                                                            return
                                                        }
                                                        runAction(
                                                            `rename-${method.id}`,
                                                            () => updatePaymentMethodAction(method.id, { name }),
                                                            "名前を変更しました"
                                                        )
                                                    }}
                                                />
                                            )}
                                            {method.accountLink.status === "UNSET" && (
                                                <LegacyAccountButton
                                                    method={method}
                                                    ledgerAccounts={ledgerAccounts}
                                                    disabled={pendingId === `account-${method.id}`}
                                                    onPick={(value) =>
                                                        runAction(
                                                            `account-${method.id}`,
                                                            () => setPaymentMethodAccountLinkAction(method.id, value),
                                                            "引き落とし先を保存しました"
                                                        )
                                                    }
                                                />
                                            )}
                                        </div>
                                        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                                            {method.subscriptionCount === 0
                                                ? "未使用"
                                                : `${method.subscriptionCount}件`}
                                        </span>
                                        <Switch
                                            id={`payment-method-active-${method.id}`}
                                            aria-label={`${method.name} を選択肢に出す`}
                                            checked={method.isActive}
                                            onCheckedChange={(checked) =>
                                                runAction(
                                                    `active-${method.id}`,
                                                    () =>
                                                        updatePaymentMethodAction(method.id, {
                                                            isActive: checked,
                                                        }),
                                                    checked ? "選択肢に出します" : "選択肢から外しました"
                                                )
                                            }
                                        />
                                        {method.accountLink.status !== "LINKED" && (
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                aria-label={`${method.name} を削除`}
                                                disabled={pendingId === `delete-${method.id}`}
                                                onClick={() =>
                                                    runAction(
                                                        `delete-${method.id}`,
                                                        () => deletePaymentMethodAction(method.id),
                                                        "削除しました"
                                                    )
                                                }
                                            >
                                                {pendingId === `delete-${method.id}` ? (
                                                    <Loader2 className="size-4 animate-spin" />
                                                ) : (
                                                    <Trash2 className="size-4" />
                                                )}
                                            </Button>
                                        )}
                                    </SortableRow>
                                ))}
                            </div>
                        </SortableContext>
                    </DndContext>
                )}

                <div className="flex gap-2">
                    <Input
                        id="new-payment-method"
                        value={newName}
                        maxLength={50}
                        placeholder="口座を通らない支払い方法を追加（例: 請求書払い）"
                        onChange={(event) => setNewName(event.target.value)}
                    />
                    <Button
                        variant="outline"
                        disabled={newName.trim() === "" || pendingId === "create"}
                        onClick={async () => {
                            const created = await runAction(
                                "create",
                                () => createPaymentMethodAction(newName),
                                "追加しました"
                            )
                            if (created) setNewName("")
                        }}
                    >
                        <Plus className="size-4" />
                        追加
                    </Button>
                </div>
            </CardContent>
        </Card>
    )
}

function LabelPanel({ labels, onChanged }: { labels: LabelView[]; onChanged: () => void }) {
    const { pendingId, runAction } = useToastedAction(onChanged)
    const [newName, setNewName] = React.useState("")

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">ラベル</CardTitle>
                <CardDescription>
                    サブスクに付けた名前がそのまま辞書になります。色は16色から選べます。
                </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
                {labels.length === 0 ? (
                    <p className="text-sm text-muted-foreground">まだラベルがありません。</p>
                ) : (
                    <div className="flex flex-col">
                        {labels.map((label) => (
                            <div key={label.id} className="flex items-center gap-2 border-b py-2 last:border-b-0">
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <button
                                            type="button"
                                            aria-label={`${label.name} の色を変える`}
                                            className="size-5 shrink-0 rounded-md border"
                                            style={{ backgroundColor: label.color }}
                                        />
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-2">
                                        <div className="grid grid-cols-8 gap-1.5">
                                            {LABEL_COLOR_PALETTE.map((color) => (
                                                <button
                                                    key={color}
                                                    type="button"
                                                    aria-label={color}
                                                    className="size-6 rounded-md border"
                                                    style={{ backgroundColor: color }}
                                                    onClick={() =>
                                                        runAction(
                                                            `color-${label.id}`,
                                                            () => updateLabelAction(label.id, { color }),
                                                            "色を変更しました"
                                                        )
                                                    }
                                                />
                                            ))}
                                        </div>
                                    </PopoverContent>
                                </Popover>
                                <Input
                                    id={`label-${label.id}`}
                                    defaultValue={label.name}
                                    maxLength={30}
                                    className="h-8 flex-1 border-transparent bg-transparent shadow-none focus-visible:border-input"
                                    onBlur={(event) => {
                                        const name = event.target.value.trim()
                                        if (!name || name === label.name) {
                                            event.target.value = label.name
                                            return
                                        }
                                        runAction(
                                            `rename-${label.id}`,
                                            () => updateLabelAction(label.id, { name }),
                                            "名前を変更しました"
                                        )
                                    }}
                                />
                                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                                    {label.subscriptionCount === 0 ? "未使用" : `${label.subscriptionCount}件`}
                                </span>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label={`${label.name} を削除`}
                                    disabled={pendingId === `delete-${label.id}`}
                                    onClick={() =>
                                        runAction(
                                            `delete-${label.id}`,
                                            () => deleteLabelAction(label.id),
                                            "削除しました（付いていたサブスクからは外れます）"
                                        )
                                    }
                                >
                                    {pendingId === `delete-${label.id}` ? (
                                        <Loader2 className="size-4 animate-spin" />
                                    ) : (
                                        <Trash2 className="size-4" />
                                    )}
                                </Button>
                            </div>
                        ))}
                    </div>
                )}

                <div className="flex gap-2">
                    <Input
                        id="new-label"
                        value={newName}
                        maxLength={30}
                        placeholder="ラベルを追加（例: 仕事用）"
                        onChange={(event) => setNewName(event.target.value)}
                    />
                    <Button
                        variant="outline"
                        disabled={newName.trim() === "" || pendingId === "create"}
                        onClick={async () => {
                            const created = await runAction("create", () => createLabelAction(newName), "追加しました")
                            if (created) setNewName("")
                        }}
                    >
                        <Plus className="size-4" />
                        追加
                    </Button>
                </div>
            </CardContent>
        </Card>
    )
}
