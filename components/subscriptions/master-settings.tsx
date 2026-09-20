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
import { LABEL_COLOR_PALETTE } from "@/lib/subscription-labels"
import type { LabelView, PaymentMethodView } from "@/lib/subscription-service"
import {
    createLabelAction,
    createPaymentMethodAction,
    deleteLabelAction,
    deletePaymentMethodAction,
    reorderPaymentMethodsAction,
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
    labels,
    onChanged,
}: {
    paymentMethods: PaymentMethodView[]
    labels: LabelView[]
    onChanged: () => void
}) {
    return (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <PaymentMethodPanel paymentMethods={paymentMethods} onChanged={onChanged} />
            <LabelPanel labels={labels} onChanged={onChanged} />
        </div>
    )
}

function PaymentMethodPanel({
    paymentMethods,
    onChanged,
}: {
    paymentMethods: PaymentMethodView[]
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
                    サブスクの登録で選べる選択肢です。並び替えると入力時の並びも変わります。
                </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
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
                                        <Input
                                            id={`payment-method-${method.id}`}
                                            defaultValue={method.name}
                                            maxLength={50}
                                            className="h-8 flex-1 border-transparent bg-transparent shadow-none focus-visible:border-input"
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
                        placeholder="支払い方法を追加（例: 三井住友カード）"
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
