/**
 * 口座結合（`mergeAccount`）で、結合元の口座に紐づくサブスクの支払い方法を結合先へ寄せる（#1011）。
 *
 * 支払い方法は口座ごとに1行（`@@unique([userId, ledgerAccountId])`）なので、結合元の `ledgerAccountId` を
 * 結合先へ一括更新すると、両方の口座に行があるとき一意制約違反になる。支払い方法画面を一度開けば
 * 表示中の全口座に行が作られるため、通常の運用でこの組合せになる。
 *
 * - 結合先の行がある: 結合元の行の履歴を結合先の行へ付け替え、結合元の行を消す
 * - 結合先の行がない: 結合元の行の口座だけを結合先へ更新する（行のidと名前は保つ）
 */

type PaymentMethodMergeClient = {
    subscriptionPaymentMethod: {
        findFirst(args: {
            where: { userId: string; ledgerAccountId: number }
            select: { id: true }
        }): Promise<{ id: number } | null>
        update(args: { where: { id: number }; data: { ledgerAccountId: number } }): Promise<unknown>
        deleteMany(args: { where: { id: number; userId: string } }): Promise<unknown>
    }
    subscriptionPaymentMethodHistory: {
        updateMany(args: { where: { paymentMethodId: number }; data: { paymentMethodId: number } }): Promise<unknown>
    }
}

export async function mergeSubscriptionPaymentMethods(
    tx: PaymentMethodMergeClient,
    userId: string,
    sourceId: number,
    targetId: number
): Promise<void> {
    const sourceRow = await tx.subscriptionPaymentMethod.findFirst({ where: { userId, ledgerAccountId: sourceId }, select: { id: true } })
    if (!sourceRow) return
    const targetRow = await tx.subscriptionPaymentMethod.findFirst({ where: { userId, ledgerAccountId: targetId }, select: { id: true } })
    if (!targetRow) {
        await tx.subscriptionPaymentMethod.update({ where: { id: sourceRow.id }, data: { ledgerAccountId: targetId } })
        return
    }
    // 履歴の一意キーは (subscriptionId, effectiveFrom) で支払い方法を含まないため、付け替えても衝突しない
    await tx.subscriptionPaymentMethodHistory.updateMany({ where: { paymentMethodId: sourceRow.id }, data: { paymentMethodId: targetRow.id } })
    await tx.subscriptionPaymentMethod.deleteMany({ where: { id: sourceRow.id, userId } })
}
