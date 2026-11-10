"use client"

/**
 * レシートの商品に付ける家計簿のカテゴリのピッカー（Issue #843。#322 の内訳ピッカーを家計簿のカテゴリへ移したもの）。
 *
 * 支出のカテゴリは数が多いため、フラットな `Select` へ全件並べると選べない。
 * ここでは「よく使うカテゴリ（2行まで）→ 大分類（タップでその場に中分類が開くアコーディオン）」の順に選べるようにし、
 * 大分類をまたぐ検索を足している（#1312。大分類を開いても画面は遷移しない）。
 *
 * - **非表示にしたカテゴリは、いま選ばれているものだけが選択肢に来る**（`buildReceiptCategoryChoices`）。
 *   一覧では薄く出す。カテゴリの表示・非表示は家計簿の「カテゴリ」タブで変える
 * - スマホは画面中央のダイアログ、それ以外はボタン直下のポップオーバー（Issue #339）。
 *   判定は既存の `useIsMobile`（768px 未満）に合わせている。スマホは指の可動域が
 *   限られるため、一覧の行・検索欄の余白は広げてタップしやすくする（文字は小さめ。#1312）
 */

import * as React from "react"
import { Check, ChevronRight, ChevronsUpDown, Loader2, Search, Sparkles } from "lucide-react"

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"
import {
    choiceLabel,
    filterCategoryChoices,
    groupCategoryChoices,
    normalizeCategoryQuery,
    pickFrequentCategories,
    type ReceiptCategoryChoice,
} from "@/lib/receipt-category-choices"

export interface CategoryPickerProps {
    categories: ReceiptCategoryChoice[]
    /** 分類履歴で使った回数が多い順の `ledgerCategoryId`。空なら「よく使う」は出さない。 */
    frequentCategoryIds: number[]
    /** いま選んでいるカテゴリ（`ledgerCategoryId`）。 */
    value: number | null
    onChange: (choice: ReceiptCategoryChoice) => void
    disabled?: boolean
    size?: "sm" | "default"
    className?: string
    placeholder?: string
    /**
     * 渡すと、ピッカーの先頭に「AIのおすすめ」を出す（#686）。「AIに聞く」を押したときだけ呼ぶ。
     * 失敗は `error` に文言を入れて返す。
     */
    onRequestSuggestions?: () => Promise<{ candidates: CategoryCandidate[] } | { error: string }>
}

export interface CategoryCandidate {
    ledgerCategoryId: number
    reason: string
}

type SuggestState =
    | { status: "idle" }
    | { status: "loading" }
    | { status: "done"; candidates: CategoryCandidate[] }
    | { status: "error"; message: string }

/**
 * 開いた瞬間にキーボードを出さない（#686）。Radixは開くと最初のフォーカス可能な要素（検索欄）へ
 * 自動でフォーカスするため、iPadのように幅768px以上でタッチ操作の端末でもキーボードが出る。
 * 検索したい人は検索欄を自分でタップすればよい。
 */
function keepKeyboardClosed(event: Event) {
    event.preventDefault()
}

export function CategoryPicker({
    categories,
    frequentCategoryIds,
    value,
    onChange,
    disabled,
    size = "default",
    className,
    placeholder = "カテゴリを選んでください",
    onRequestSuggestions,
}: CategoryPickerProps) {
    const isMobile = useIsMobile()
    const [open, setOpen] = React.useState(false)
    const [query, setQuery] = React.useState("")
    const [groupId, setGroupId] = React.useState<number | null>(null)
    const [suggest, setSuggest] = React.useState<SuggestState>({ status: "idle" })

    const selected = categories.find((choice) => choice.ledgerCategoryId === value) ?? null

    // 開くたびに最初の画面（よく使う＋大分類）へ戻す。前に見ていた大分類や検索語が残っていると、
    // 別の明細で開いたときに関係のない一覧が出る。**選び直しでも大分類の中から始めない** —
    // カテゴリを変えたい理由の多くは分類そのものの取り違えで、同じ大分類の中とは限らない。
    const openPicker = (next: boolean) => {
        if (next) {
            setQuery("")
            setGroupId(null)
            setSuggest({ status: "idle" })
        }
        setOpen(next)
    }

    const pick = (choice: ReceiptCategoryChoice) => {
        onChange(choice)
        setOpen(false)
    }

    const askAi = async () => {
        if (!onRequestSuggestions) return
        setSuggest({ status: "loading" })
        try {
            const result = await onRequestSuggestions()
            setSuggest(
                "error" in result
                    ? { status: "error", message: result.error }
                    : { status: "done", candidates: result.candidates }
            )
        } catch {
            setSuggest({ status: "error", message: "AIの候補を取得できませんでした" })
        }
    }

    const trigger = (
        <button
            type="button"
            disabled={disabled}
            aria-label={selected ? "カテゴリを変更" : "カテゴリを選ぶ"}
            className={cn(
                "border-input focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 dark:hover:bg-input/50",
                "flex items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs",
                "transition-[color,box-shadow] outline-none focus-visible:ring-[3px]",
                "disabled:cursor-not-allowed disabled:opacity-50",
                size === "sm" ? "h-8" : "h-9",
                className
            )}
        >
            {selected ? (
                <span className="min-w-0 truncate text-left">
                    {selected.genreName ? (
                        <>
                            <span className="text-muted-foreground">{selected.categoryName} / </span>
                            {selected.genreName}
                        </>
                    ) : (
                        selected.categoryName
                    )}
                </span>
            ) : (
                <span className="text-muted-foreground min-w-0 truncate text-left">{placeholder}</span>
            )}
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </button>
    )

    const body = (
        <PickerBody
            categories={categories}
            frequentCategoryIds={frequentCategoryIds}
            value={value}
            query={query}
            onQueryChange={setQuery}
            groupId={groupId}
            onGroupChange={setGroupId}
            onPick={pick}
            suggest={onRequestSuggestions ? suggest : null}
            onAskAi={askAi}
            // スマホは指の可動域が限られるため、行・チップ・検索欄の余白と文字サイズを広げる。
            comfortable={isMobile}
        />
    )

    if (isMobile) {
        return (
            <Dialog open={open} onOpenChange={openPicker}>
                <DialogTrigger asChild>{trigger}</DialogTrigger>
                <DialogContent
                    aria-describedby={undefined}
                    className="max-h-[85vh] gap-0 p-0"
                    onOpenAutoFocus={keepKeyboardClosed}
                >
                    <DialogHeader className="p-4 pb-2 text-left">
                        <DialogTitle className="text-base">カテゴリを選ぶ</DialogTitle>
                    </DialogHeader>
                    {body}
                </DialogContent>
            </Dialog>
        )
    }

    return (
        <Popover open={open} onOpenChange={openPicker}>
            <PopoverTrigger asChild>{trigger}</PopoverTrigger>
            <PopoverContent
                align="start"
                className="w-[min(22rem,calc(100vw-2rem))] p-0"
                onOpenAutoFocus={keepKeyboardClosed}
            >
                {body}
            </PopoverContent>
        </Popover>
    )
}

/* ───────────────────────── 中身 ───────────────────────── */

function PickerBody({
    categories,
    frequentCategoryIds,
    value,
    query,
    onQueryChange,
    groupId,
    onGroupChange,
    onPick,
    suggest,
    onAskAi,
    comfortable,
}: {
    categories: ReceiptCategoryChoice[]
    frequentCategoryIds: number[]
    value: number | null
    query: string
    onQueryChange: (value: string) => void
    /** 中分類を開いている大分類（アコーディオン）。なければ全部閉じる。 */
    groupId: number | null
    onGroupChange: (value: number | null) => void
    onPick: (choice: ReceiptCategoryChoice) => void
    suggest: SuggestState | null
    onAskAi: () => void
    /** スマホ（ダイアログ表示）のとき true。行・チップ・検索欄の余白と文字サイズを広げる。 */
    comfortable: boolean
}) {
    const searching = normalizeCategoryQuery(query).length > 0
    const groups = React.useMemo(() => groupCategoryChoices(categories), [categories])

    if (categories.length === 0) {
        return (
            <div className="px-6 py-10 text-center">
                <p className="text-sm font-medium">家計簿のカテゴリがまだありません</p>
                <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">
                    家計簿の「カテゴリ」タブで、おすすめの体系を取り込むかカテゴリを作ってください。
                </p>
            </div>
        )
    }

    return (
        <div className="flex max-h-[70vh] flex-col sm:max-h-[26rem]">
            <div
                className={cn(
                    "flex items-center gap-2 border-b px-3",
                    comfortable ? "py-3" : "py-2"
                )}
            >
                <Search className={cn("text-muted-foreground shrink-0", "size-4")} />
                <input
                    value={query}
                    onChange={(event) => onQueryChange(event.target.value)}
                    placeholder="カテゴリを検索"
                    aria-label="カテゴリを検索"
                    className={cn(
                        "placeholder:text-muted-foreground w-full bg-transparent outline-none",
                        "text-sm"
                    )}
                />
            </div>

            {suggest && !searching && (
                <AiSuggestions
                    state={suggest}
                    categories={categories}
                    value={value}
                    onAsk={onAskAi}
                    onPick={onPick}
                    comfortable={comfortable}
                />
            )}

            <div className="min-h-0 flex-1 overflow-y-auto">
                {searching ? (
                    <SearchResults categories={categories} query={query} value={value} onPick={onPick} comfortable={comfortable} />
                ) : (
                    <GroupBrowser
                        categories={categories}
                        groups={groups}
                        openGroupId={groupId}
                        frequentCategoryIds={frequentCategoryIds}
                        value={value}
                        onGroupChange={onGroupChange}
                        onPick={onPick}
                        comfortable={comfortable}
                    />
                )}
            </div>
        </div>
    )
}

function AiSuggestions({
    state,
    categories,
    value,
    onAsk,
    onPick,
    comfortable,
}: {
    state: SuggestState
    categories: ReceiptCategoryChoice[]
    value: number | null
    onAsk: () => void
    onPick: (choice: ReceiptCategoryChoice) => void
    comfortable: boolean
}) {
    const rows =
        state.status === "done"
            ? state.candidates.flatMap((candidate) => {
                  const choice = categories.find((c) => c.ledgerCategoryId === candidate.ledgerCategoryId)
                  return choice ? [{ choice, reason: candidate.reason }] : []
              })
            : []

    return (
        <div className="border-primary/40 bg-primary/5 mx-3 my-2.5 rounded-lg border p-2.5">
            <div className="flex items-center justify-between gap-2">
                <span className={cn("text-primary flex items-center gap-1 font-medium text-xs")}>
                    <Sparkles className="size-3.5" />
                    AIのおすすめ
                </span>
                {state.status !== "loading" && (
                    <button
                        type="button"
                        onClick={onAsk}
                        className={cn(
                            "border-primary text-primary rounded-md border px-2.5 whitespace-nowrap",
                            comfortable ? "py-1.5 text-xs" : "py-1 text-xs"
                        )}
                    >
                        {state.status === "idle" ? "AIに聞く" : "もう一度聞く"}
                    </button>
                )}
                {state.status === "loading" && (
                    <span className="text-muted-foreground flex items-center gap-1 text-xs">
                        <Loader2 className="size-3.5 animate-spin" />
                        考え中…
                    </span>
                )}
            </div>
            {state.status === "error" && (
                <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{state.message}</p>
            )}
            {state.status === "done" && rows.length === 0 && (
                <p className="text-muted-foreground mt-1.5 text-xs">商品名からは候補を絞れませんでした。</p>
            )}
            {rows.map(({ choice, reason }) => (
                <button
                    key={choice.ledgerCategoryId}
                    type="button"
                    onClick={() => onPick(choice)}
                    className={cn(
                        "hover:bg-accent mt-1.5 flex w-full items-center justify-between gap-2 rounded-md px-2 text-left",
                        comfortable ? "py-2.5" : "py-1.5"
                    )}
                >
                    <span className="min-w-0">
                        <span className="text-sm">
                            <ChoiceName choice={choice} />
                        </span>
                        {reason && <span className="text-muted-foreground block text-[11px]">{reason}</span>}
                    </span>
                    {choice.ledgerCategoryId === value && <Check className="size-4 shrink-0" />}
                </button>
            ))}
        </div>
    )
}

/** 「大分類 / 中分類」。中分類の無い大分類は大分類名だけ。 */
function ChoiceName({ choice, mutedOpacity = false }: { choice: ReceiptCategoryChoice; mutedOpacity?: boolean }) {
    if (!choice.genreName) return <>{choice.categoryName}</>
    return (
        <>
            <span className={mutedOpacity ? "opacity-70" : "text-muted-foreground"}>{choice.categoryName} / </span>
            {choice.genreName}
        </>
    )
}

function GroupBrowser({
    categories,
    groups,
    openGroupId,
    frequentCategoryIds,
    value,
    onGroupChange,
    onPick,
    comfortable,
}: {
    categories: ReceiptCategoryChoice[]
    groups: ReturnType<typeof groupCategoryChoices>
    openGroupId: number | null
    frequentCategoryIds: number[]
    value: number | null
    onGroupChange: (value: number | null) => void
    onPick: (choice: ReceiptCategoryChoice) => void
    comfortable: boolean
}) {
    const frequent = pickFrequentCategories(categories, frequentCategoryIds)

    return (
        <>
            {frequent.length > 0 && (
                <>
                    <SectionLabel comfortable={comfortable}>よく使う</SectionLabel>
                    <div
                        className={cn(
                            // 2行までに収める（#1312）。入りきらない分は高さで切り、頻度の高い順に残す
                            "flex max-h-[3.75rem] flex-wrap gap-1.5 overflow-hidden px-3",
                            "mb-2.5"
                        )}
                    >
                        {frequent.map((choice) => (
                            <button
                                key={choice.ledgerCategoryId}
                                type="button"
                                onClick={() => onPick(choice)}
                                className={cn(
                                    "hover:bg-accent rounded-full border px-2.5 py-1 text-xs transition-colors",
                                    choice.ledgerCategoryId === value &&
                                        "bg-primary text-primary-foreground border-primary hover:bg-primary"
                                )}
                            >
                                <ChoiceName choice={choice} mutedOpacity={choice.ledgerCategoryId === value} />
                            </button>
                        ))}
                    </div>
                </>
            )}

            <SectionLabel comfortable={comfortable}>大分類から選ぶ</SectionLabel>
            {groups.map((group) => {
                // 中分類を持たない大分類は、開かずにそのまま選ぶ
                const single = group.categories.length === 1 && group.categories[0].genreName === null
                    ? group.categories[0]
                    : null
                const expanded = !single && openGroupId === group.groupId
                return (
                    <React.Fragment key={group.groupId}>
                        <button
                            type="button"
                            aria-expanded={single ? undefined : expanded}
                            onClick={() =>
                                single ? onPick(single) : onGroupChange(expanded ? null : group.groupId)
                            }
                            className={cn(
                                "hover:bg-accent flex w-full items-center gap-2 border-t px-3 text-left text-sm transition-colors",
                                comfortable ? "py-3" : "py-2",
                                group.categories.every((choice) => choice.hidden) && "text-muted-foreground",
                                single && single.ledgerCategoryId === value && "bg-muted font-medium"
                            )}
                        >
                            <span className="min-w-0 truncate">{group.categoryName}</span>
                            {single ? (
                                single.ledgerCategoryId === value && (
                                    <Check className="ml-auto size-3.5 shrink-0" />
                                )
                            ) : (
                                <>
                                    <span className="text-muted-foreground ml-auto text-xs tabular-nums">
                                        {group.categories.length}
                                    </span>
                                    <ChevronRight
                                        className={cn(
                                            "text-muted-foreground/60 size-3.5 shrink-0 transition-transform",
                                            expanded && "rotate-90"
                                        )}
                                    />
                                </>
                            )}
                        </button>
                        {expanded && (
                            <div className="bg-muted/40">
                                <ChoiceList
                                    choices={group.categories}
                                    query=""
                                    value={value}
                                    onPick={onPick}
                                    showCategory={false}
                                    comfortable={comfortable}
                                    indent
                                />
                            </div>
                        )}
                    </React.Fragment>
                )
            })}
        </>
    )
}

function SearchResults({
    categories,
    query,
    value,
    onPick,
    comfortable,
}: {
    categories: ReceiptCategoryChoice[]
    query: string
    value: number | null
    onPick: (choice: ReceiptCategoryChoice) => void
    comfortable: boolean
}) {
    const matched = filterCategoryChoices(categories, query)

    if (matched.length === 0) {
        return (
            <p className="text-muted-foreground px-3 py-8 text-center text-xs">
                「{query}」に一致するカテゴリはありません
            </p>
        )
    }

    return (
        <>
            <SectionLabel comfortable={comfortable}>{matched.length}件</SectionLabel>
            <ChoiceList choices={matched} query={query} value={value} onPick={onPick} comfortable={comfortable} />
        </>
    )
}

function ChoiceList({
    choices,
    query,
    value,
    onPick,
    comfortable,
    showCategory = true,
    indent = false,
}: {
    choices: ReceiptCategoryChoice[]
    query: string
    value: number | null
    onPick: (choice: ReceiptCategoryChoice) => void
    comfortable: boolean
    showCategory?: boolean
    /** アコーディオンの中分類として、左に余白を足す。 */
    indent?: boolean
}) {
    return (
        <>
            {choices.map((choice) => (
                <button
                    key={choice.ledgerCategoryId}
                    type="button"
                    onClick={() => onPick(choice)}
                    aria-label={choiceLabel(choice)}
                    className={cn(
                        "hover:bg-accent flex w-full items-center gap-2 border-t pr-3 text-left text-sm transition-colors",
                        indent ? "pl-6" : "pl-3",
                        comfortable ? "py-3" : "py-2",
                        // 非表示のカテゴリ（いま選ばれているものだけが来る）は薄く出す
                        choice.hidden && "text-muted-foreground",
                        choice.ledgerCategoryId === value && "bg-muted font-medium"
                    )}
                >
                    <span className="min-w-0 truncate">
                        <Highlight text={choice.genreName ?? choice.categoryName} query={query} />
                    </span>
                    {showCategory && choice.genreName !== null && (
                        <span
                            className={cn(
                                "text-muted-foreground ml-auto shrink-0",
                                comfortable ? "text-xs" : "text-[11px]"
                            )}
                        >
                            {choice.categoryName}
                        </span>
                    )}
                    {choice.ledgerCategoryId === value && (
                        <Check
                            className={cn(
                                "size-3.5 shrink-0",
                                showCategory && choice.genreName !== null ? "" : "ml-auto"
                            )}
                        />
                    )}
                </button>
            ))}
        </>
    )
}

function SectionLabel({ children, comfortable }: { children: React.ReactNode; comfortable: boolean }) {
    return (
        <div
            className={cn(
                "text-muted-foreground px-3 pt-2.5 pb-1 font-medium",
                comfortable ? "text-xs" : "text-[11px]"
            )}
        >
            {children}
        </div>
    )
}

/** 検索語に当たったところを目立たせる。位置が引けないときは、そのまま出す。 */
function Highlight({ text, query }: { text: string; query: string }) {
    const needle = query.trim()
    if (!needle) return <>{text}</>
    const index = text.toLowerCase().indexOf(needle.toLowerCase())
    if (index < 0) return <>{text}</>
    return (
        <>
            {text.slice(0, index)}
            <mark className="bg-primary/15 text-foreground rounded-[2px] px-0.5">
                {text.slice(index, index + needle.length)}
            </mark>
            {text.slice(index + needle.length)}
        </>
    )
}
