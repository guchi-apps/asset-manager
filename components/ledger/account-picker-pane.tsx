"use client"

import * as React from "react"
import { Check, ChevronLeft } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/** 口座の選択ページ・取引フォーム・レシート確認で共有する（手入力の口座選択ページと同じ見た目・動き。#1295） */
export const LATER = "later"
export const PAY_LATER = "paylater"

/** 選べる口座（手入力は `LedgerAccountView`、レシート確認は登録用の一覧）。ヒントを出すときだけ `hasStatementFeed` を使う */
export interface PickableAccount {
    id: number
    name: string
    hasStatementFeed?: boolean
}

/** 選択ページの枠（編集画面の右に控えていて、「戻る」で編集画面へ戻る。#948） */
export function PickerFrame({
    active,
    className,
    title,
    backId,
    onBack,
    children,
}: {
    active: boolean
    className?: string
    title: string
    backId: string
    onBack: () => void
    children: React.ReactNode
}) {
    return (
        <div
            inert={!active}
            aria-hidden={!active}
            className={cn(
                "col-start-1 row-start-1 flex min-h-0 flex-col bg-background transition-transform duration-300 ease-out motion-reduce:transition-none",
                active ? "translate-x-0" : "translate-x-full",
                className
            )}>
            <div className="flex items-center gap-1 border-b px-2 py-2 pr-12">
                <Button id={backId} type="button" variant="ghost" size="sm" onClick={onBack} className="h-10 gap-0.5 px-2 text-primary">
                    <ChevronLeft />
                    戻る
                </Button>
                <h2 className="min-w-0 flex-1 truncate text-base font-semibold">{title}</h2>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[max(0.75rem,env(safe-area-inset-bottom))]">{children}</div>
        </div>
    )
}

/** 選択ページの1行（選択中は背景とチェックで示す） */
export function PickerItem({
    selected,
    onPick,
    indent = false,
    strong = false,
    hint,
    children,
}: {
    selected: boolean
    onPick: () => void
    indent?: boolean
    strong?: boolean
    hint?: string
    children: React.ReactNode
}) {
    return (
        <button
            type="button"
            onClick={onPick}
            aria-current={selected ? "true" : undefined}
            className={cn(
                "flex min-h-12 w-full items-center justify-between gap-3 border-t px-4 py-2.5 text-left text-[15px] outline-none first:border-t-0 focus-visible:bg-accent sm:px-5",
                indent && "pl-9 sm:pl-10",
                (selected || strong) && "font-medium",
                selected && "bg-accent"
            )}>
            <span className="min-w-0">
                {children}
                {hint && <span className="block text-xs font-normal text-muted-foreground">{hint}</span>}
            </span>
            {selected && <Check className="size-4 shrink-0 text-primary" aria-hidden />}
        </button>
    )
}

/** 口座を選ぶページ。編集画面の右に控えていて、選ぶか「戻る」で編集画面へ戻る（#948） */
export function AccountPickerPane({
    active,
    title,
    value,
    accounts,
    laterOption,
    feedHint,
    className,
    onBack,
    onPick,
}: {
    active: boolean
    className?: string
    title: string
    value: string
    accounts: PickableAccount[]
    /** 「あとで決める」「後払い」の出し分け。both＝両方（支出の支払い口座。#859・#880）、later＝「あとで決める」だけ（支払いを分ける行）、none＝出さない */
    laterOption: "none" | "later" | "both"
    /** 明細が届く口座に「反映待ちになります」と添える（選ぶと反映待ちになる欄だけ。#1044） */
    feedHint: boolean
    onBack: () => void
    onPick: (value: string) => void
}) {
    const item = (v: string, name: string, hint?: string) => (
        <PickerItem key={v} selected={value === v} onPick={() => onPick(v)} hint={hint}>
            {name}
        </PickerItem>
    )
    return (
        <PickerFrame active={active} className={className} title={title} backId="ledger-account-back" onBack={onBack}>
            {laterOption !== "none" && (
                <>
                    {item(LATER, "あとで決める", "口座が分からない。カード明細が届いたら口座も決まります（反映待ち）")}
                    {laterOption === "both" && item(PAY_LATER, "後払い", "あとで払う")}
                    <div className="h-2 border-y bg-muted/40" aria-hidden />
                </>
            )}
            {accounts.map((a) => item(String(a.id), a.name, feedHint && a.hasStatementFeed ? "明細が届く口座（反映待ちになります）" : undefined))}
        </PickerFrame>
    )
}
