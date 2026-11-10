"use client"

import * as React from "react"
import Link from "next/link"
import { Landmark, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { FieldRow } from "@/components/ledger/field-row"
import { formatDate, formatYen } from "@/components/ledger/format"
import {
    getAttachPreviewAction,
    getReceiptLedgerStateAction,
    registerReceiptToLedgerAction,
    unregisterReceiptFromLedgerAction,
    type AttachRequest,
    type ReceiptLedgerState,
} from "@/app/actions/ledger"
import { AttachPreviewPanel, receiptPanelPreview } from "@/components/ledger/attach-preview"
import type { AttachPreviewView, LedgerCandidateView } from "@/lib/ledger-receipt-service"

/** 「あとで決める（カード明細と照合）」。口座未定の反映待ちで登録する（#859） */
const LATER = "later"
const STATUS_LABELS: Record<string, string> = {
    CONFIRMED: "確定",
    PENDING_STATEMENT: "反映待ち",
    MATCH_PENDING: "照合待ち",
}

/**
 * レシート・メールを家計簿へ登録する（Issue #818）。Zaimへは何も送らない。
 *
 * 既定は「あとで決める」。口座未定の反映待ちで登録し、カード明細が届いたら確認待ちの画面で人が確かめて口座を決める（#859）。
 * 現金・PayPayなど明細の届かない口座を選んだときだけ、その場で確定する。同じ金額・日付の取引（すでに届いたカード明細など）が
 * あれば、1件でも付けるかを選んでもらう。
 * 登録の前に、画面の編集内容を保存する（`beforeRegister`）。
 *
 * 画面では「支払い方法」を店舗名の下、「登録ボタン」を最後に置く（#1088）ため、状態は `useReceiptLedger` が持ち、
 * `ReceiptLedgerAccount`・`ReceiptLedgerRegister` の2つへ渡す。
 */
export function useReceiptLedger({
    receiptId,
    beforeRegister,
    disabledReason,
    onRegistered,
}: {
    receiptId: number
    /** 家計簿への登録に成功したあと（候補選択・失敗では呼ばない） */
    onRegistered?: () => void
    beforeRegister: () => Promise<boolean>
    disabledReason: string | null
}) {
    const [state, setState] = React.useState<ReceiptLedgerState | null>(null)
    const [accountId, setAccountId] = React.useState(LATER)
    const [busy, setBusy] = React.useState(false)
    const [candidates, setCandidates] = React.useState<LedgerCandidateView[] | null>(null)
    /** 付け先を選んだあと、付ける前に見せる変更内容（#947） */
    const [preview, setPreview] = React.useState<AttachPreviewView | null>(null)

    const load = React.useCallback(async () => {
        const next = await getReceiptLedgerStateAction(receiptId)
        setState(next)
        if (next?.ledgerAccountId) setAccountId(String(next.ledgerAccountId))
    }, [receiptId])

    React.useEffect(() => {
        void load()
    }, [load])

    const chooseAccount = (value: string) => {
        setAccountId(value)
        setCandidates(null)
    }

    /** 付け先の取引を選んだら、すぐ付けずに変更内容を見せる */
    const showPreview = async (targetEntryId: number) => {
        setBusy(true)
        try {
            if (!(await beforeRegister())) return
            const result = await getAttachPreviewAction(targetEntryId, receiptId, accountId === LATER ? null : Number(accountId))
            if (!result.success) toast.error(result.error)
            else setPreview(result.data)
        } finally {
            setBusy(false)
        }
    }

    const register = async (targetEntryId?: number, attach?: AttachRequest) => {
        setBusy(true)
        try {
            if (!(await beforeRegister())) return
            const result = await registerReceiptToLedgerAction(receiptId, accountId === LATER ? null : Number(accountId), targetEntryId, attach)
            if (!result.success) {
                toast.error(result.error)
                return
            }
            if (result.data.result === "choose") {
                setCandidates(result.data.candidates)
                toast.info("同じ支払いかもしれない取引があります。付けるか選んでください")
                return
            }
            setCandidates(null)
            setPreview(null)
            toast.success(
                result.data.result === "attached"
                    ? "カード明細などの取引の内訳として家計簿に登録しました"
                    : result.data.status === "PENDING_STATEMENT"
                      ? accountId === LATER
                          ? "口座未定で家計簿に登録しました（カード明細が届いたら確認します）"
                          : "反映待ちとして家計簿に登録しました（カード明細が届いたら確認します）"
                      : "家計簿に登録しました"
            )
            await load()
            onRegistered?.()
        } finally {
            setBusy(false)
        }
    }

    const unregister = async () => {
        setBusy(true)
        try {
            const result = await unregisterReceiptFromLedgerAction(receiptId)
            if (!result.success) toast.error(result.error)
            else toast.success("家計簿から外しました")
            await load()
        } finally {
            setBusy(false)
        }
    }

    return {
        receiptId,
        state,
        accountId,
        busy,
        candidates,
        preview,
        disabledReason,
        chooseAccount,
        showPreview,
        register,
        unregister,
        clearPreview: () => setPreview(null),
    }
}

export type ReceiptLedgerController = ReturnType<typeof useReceiptLedger>

/** 手入力と同じ「支払い口座」の行。登録済みのときは出さない（登録状況は末尾に出る） */
export function ReceiptLedgerAccount({ ctrl }: { ctrl: ReceiptLedgerController }) {
    const { state, accountId, receiptId } = ctrl
    if (!state || state.entry) return null
    const triggerId = `receipt-ledger-account-${receiptId}`
    return (
        <FieldRow icon={Landmark} htmlFor={triggerId} label="支払い口座">
            <Select value={accountId} onValueChange={ctrl.chooseAccount}>
                <SelectTrigger
                    id={triggerId}
                    aria-label="支払い口座"
                    className="h-9 w-full justify-between gap-1 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0 dark:bg-transparent"
                >
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value={LATER}>あとで決める（カード明細と照合）</SelectItem>
                    {state.accounts.map((a) => (
                        <SelectItem key={a.id} value={String(a.id)}>
                            {a.name}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </FieldRow>
    )
}

/** 画面の最後に置く「家計簿に登録」。登録済みのときは登録状況を出す */
export function ReceiptLedgerRegister({ ctrl }: { ctrl: ReceiptLedgerController }) {
    const { state, accountId, busy, candidates, preview, disabledReason } = ctrl
    if (!state) return null
    const account = state.accounts.find((a) => String(a.id) === accountId)

    if (state.entry) {
        return (
            <div className="flex flex-col gap-2 text-sm">
                <p>
                    家計簿に登録済み：{formatDate(state.entry.date)}・{formatYen(state.entry.amount)}・
                    {state.entry.status === "PENDING_STATEMENT" && state.entry.fromAccountId == null
                        ? "口座未定・カード明細待ち"
                        : (STATUS_LABELS[state.entry.status] ?? state.entry.status)}
                    {state.entry.origin === "SOURCE" ? "（Zaimのカード明細の内訳）" : ""}
                </p>
                <div className="flex flex-wrap gap-2">
                    <Button asChild size="sm" variant="outline">
                        <Link href="/ledger">家計簿を開く</Link>
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={ctrl.unregister}>
                        家計簿から外す
                    </Button>
                </div>
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-3 text-sm">
            <Button size="lg" className="w-full" disabled={busy || disabledReason !== null} onClick={() => ctrl.register()}>
                {busy && <Loader2 className="animate-spin" />}
                家計簿に登録
            </Button>
            <p className="text-center text-xs text-muted-foreground">
                {!account
                    ? "現金・PayPayなど、明細の届かない口座で払ったときだけ支払い方法を選んでください。カードで払ったものは、カード明細が届いたときに確認して口座を決めます。Zaimへは送りません。"
                    : account.hasStatementFeed
                      ? "明細が届く口座です。「反映待ち」で登録し、明細が届いたら同じ支払いか確認します。"
                      : "明細が届かない口座（現金・PayPayなど）です。このまま確定で登録します。"}
            </p>
            {disabledReason && <p className="text-center text-xs text-amber-700 dark:text-amber-400">{disabledReason}</p>}
            {candidates && preview && (
                <AttachPreviewPanel
                    preview={receiptPanelPreview(preview)}
                    busy={busy}
                    onBack={ctrl.clearPreview}
                    onConfirm={(select) => void ctrl.register(preview.entryId, { select, expectedUpdatedAt: preview.entryUpdatedAt })}
                />
            )}
            {candidates && !preview && (
                <div className="flex flex-col gap-1 rounded-md border p-2">
                    <span className="text-xs text-muted-foreground">
                        すでに家計簿にある、同じ支払いかもしれない取引です。このカード明細などに付けますか？ 同じ支払いなら選んでください。
                    </span>
                    {candidates.map((c) => (
                        <Button key={c.id} size="sm" variant="outline" className="h-auto justify-between gap-2 whitespace-normal py-1.5 text-left" disabled={busy} onClick={() => void ctrl.showPreview(c.id)}>
                            <span>
                                {formatDate(c.date)} {c.accountName ?? "口座未定"}「{c.place ?? ""}」（{STATUS_LABELS[c.status] ?? c.status}）
                            </span>
                            <span className="shrink-0 tabular-nums">{formatYen(c.amount)}</span>
                        </Button>
                    ))}
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => ctrl.register(0)}>
                        別の支払いとして登録{accountId === LATER ? "（カード明細を待つ）" : ""}
                    </Button>
                </div>
            )}
        </div>
    )
}
