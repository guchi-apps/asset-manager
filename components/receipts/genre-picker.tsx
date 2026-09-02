"use client"

/**
 * 内訳ピッカー（Issue #322）。
 *
 * 支出の内訳は100件を超えるため、以前のようにフラットな `Select` へ全件並べると選べない。
 * ここでは「よく使う内訳 → 大分類 → その中の内訳」の順に降りられるようにし、
 * 大分類をまたぐ検索を足している。
 *
 * - **隠した内訳も選べる。** 通常の一覧からは外すが、検索には必ず出し、
 *   一覧でも「隠した内訳も出す」で戻せる（隠す設定は選択肢の削除ではない）
 * - スマホは画面中央のダイアログ、それ以外はボタン直下のポップオーバー（Issue #339）。
 *   判定は既存の `useIsMobile`（768px 未満）に合わせている。スマホは指の可動域が
 *   限られるため、一覧の行・チップ・検索欄の余白と文字サイズも広げてタップしやすくする
 */

import * as React from "react"
import { Check, ChevronLeft, ChevronRight, ChevronsUpDown, Search } from "lucide-react"

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"
import {
    filterGenres,
    groupGenresByCategory,
    normalizeGenreQuery,
    pickFrequentGenres,
    type ZaimGenreChoice,
} from "@/lib/zaim-genre-choices"

export interface GenrePickerProps {
    genres: ZaimGenreChoice[]
    /** 分類履歴で使った回数が多い順の `zaimGenreId`。空なら「よく使う」は出さない。 */
    frequentGenreIds: number[]
    /** いま選んでいる内訳。 */
    value: number | null
    onChange: (genre: ZaimGenreChoice) => void
    disabled?: boolean
    size?: "sm" | "default"
    className?: string
    placeholder?: string
}

export function GenrePicker({
    genres,
    frequentGenreIds,
    value,
    onChange,
    disabled,
    size = "default",
    className,
    placeholder = "内訳を選んでください",
}: GenrePickerProps) {
    const isMobile = useIsMobile()
    const [open, setOpen] = React.useState(false)
    const [query, setQuery] = React.useState("")
    const [categoryId, setCategoryId] = React.useState<number | null>(null)
    const [includeHidden, setIncludeHidden] = React.useState(false)

    const selected = genres.find((genre) => genre.zaimGenreId === value) ?? null

    // 開くたびに最初の画面（よく使う＋大分類）へ戻す。前に見ていた大分類や検索語が残っていると、
    // 別の明細で開いたときに関係のない一覧が出る。**選び直しでも大分類の中から始めない** —
    // 内訳を変えたい理由の多くは分類そのものの取り違えで、同じ大分類の中とは限らない。
    const openPicker = (next: boolean) => {
        if (next) {
            setQuery("")
            setCategoryId(null)
            setIncludeHidden(false)
        }
        setOpen(next)
    }

    const pick = (genre: ZaimGenreChoice) => {
        onChange(genre)
        setOpen(false)
    }

    const trigger = (
        <button
            type="button"
            disabled={disabled}
            aria-label={selected ? "内訳を変更" : "内訳を選ぶ"}
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
                    <span className="text-muted-foreground">{selected.categoryName} / </span>
                    {selected.genreName}
                </span>
            ) : (
                <span className="text-muted-foreground min-w-0 truncate text-left">{placeholder}</span>
            )}
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </button>
    )

    const body = (
        <PickerBody
            genres={genres}
            frequentGenreIds={frequentGenreIds}
            value={value}
            query={query}
            onQueryChange={setQuery}
            categoryId={categoryId}
            onCategoryChange={setCategoryId}
            includeHidden={includeHidden}
            onIncludeHiddenChange={setIncludeHidden}
            onPick={pick}
            // スマホで開いた瞬間にキーボードが出ると、一覧が半分隠れて「よく使う」も大分類も見えない。
            // 検索は必要な人が検索欄を叩けばよいので、自動フォーカスはPCだけにする。
            autoFocusSearch={!isMobile}
            // スマホは指の可動域が限られるため、行・チップ・検索欄の余白と文字サイズを広げる。
            comfortable={isMobile}
        />
    )

    if (isMobile) {
        return (
            <Dialog open={open} onOpenChange={openPicker}>
                <DialogTrigger asChild>{trigger}</DialogTrigger>
                <DialogContent aria-describedby={undefined} className="max-h-[85vh] gap-0 p-0">
                    <DialogHeader className="p-4 pb-2 text-left">
                        <DialogTitle className="text-base">内訳を選ぶ</DialogTitle>
                    </DialogHeader>
                    {body}
                </DialogContent>
            </Dialog>
        )
    }

    return (
        <Popover open={open} onOpenChange={openPicker}>
            <PopoverTrigger asChild>{trigger}</PopoverTrigger>
            <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] p-0">
                {body}
            </PopoverContent>
        </Popover>
    )
}

/* ───────────────────────── 中身 ───────────────────────── */

function PickerBody({
    genres,
    frequentGenreIds,
    value,
    query,
    onQueryChange,
    categoryId,
    onCategoryChange,
    includeHidden,
    onIncludeHiddenChange,
    onPick,
    autoFocusSearch,
    comfortable,
}: {
    genres: ZaimGenreChoice[]
    frequentGenreIds: number[]
    value: number | null
    query: string
    onQueryChange: (value: string) => void
    categoryId: number | null
    onCategoryChange: (value: number | null) => void
    includeHidden: boolean
    onIncludeHiddenChange: (value: boolean) => void
    onPick: (genre: ZaimGenreChoice) => void
    autoFocusSearch: boolean
    /** スマホ（ダイアログ表示）のとき true。行・チップ・検索欄の余白と文字サイズを広げる。 */
    comfortable: boolean
}) {
    const searching = normalizeGenreQuery(query).length > 0
    const groups = React.useMemo(() => groupGenresByCategory(genres), [genres])
    const openedGroup = groups.find((group) => group.zaimCategoryId === categoryId) ?? null
    const hiddenCount = genres.filter((genre) => genre.hidden).length

    if (genres.length === 0) {
        return (
            <div className="px-6 py-10 text-center">
                <p className="text-sm font-medium">内訳がまだ取り込まれていません</p>
                <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">
                    「設定」タブの「Zaimのマスタを取得」を押すと、Zaimのカテゴリと内訳を読み込みます。
                </p>
            </div>
        )
    }

    return (
        <div className="flex max-h-[70vh] flex-col sm:max-h-[26rem]">
            {openedGroup && !searching && (
                <div
                    className={cn(
                        "flex items-center gap-2 border-b px-3",
                        comfortable ? "py-3" : "py-2"
                    )}
                >
                    <button
                        type="button"
                        onClick={() => onCategoryChange(null)}
                        className={cn(
                            "text-muted-foreground hover:text-foreground flex items-center gap-1",
                            comfortable ? "text-sm" : "text-xs"
                        )}
                    >
                        <ChevronLeft className={comfortable ? "size-4" : "size-3.5"} />
                        大分類へ戻る
                    </button>
                    <span className={cn("ml-auto font-medium", comfortable ? "text-base" : "text-sm")}>
                        {openedGroup.categoryName}
                    </span>
                </div>
            )}

            <div
                className={cn(
                    "flex items-center gap-2 border-b px-3",
                    comfortable ? "py-3" : "py-2"
                )}
            >
                <Search className={cn("text-muted-foreground shrink-0", comfortable ? "size-5" : "size-4")} />
                <input
                    autoFocus={autoFocusSearch}
                    value={query}
                    onChange={(event) => onQueryChange(event.target.value)}
                    placeholder="内訳を検索"
                    aria-label="内訳を検索"
                    className={cn(
                        "placeholder:text-muted-foreground w-full bg-transparent outline-none",
                        comfortable ? "text-base" : "text-sm"
                    )}
                />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
                {searching ? (
                    <SearchResults genres={genres} query={query} value={value} onPick={onPick} comfortable={comfortable} />
                ) : openedGroup ? (
                    <GenreList
                        genres={
                            // その大分類の内訳がすべて隠されているときは、空の一覧を出さずに隠したものを並べる。
                            includeHidden || openedGroup.visibleCount === 0
                                ? openedGroup.genres
                                : openedGroup.genres.filter((genre) => !genre.hidden)
                        }
                        query=""
                        value={value}
                        onPick={onPick}
                        showCategory={false}
                        comfortable={comfortable}
                    />
                ) : (
                    <CategoryBrowser
                        genres={genres}
                        groups={groups}
                        frequentGenreIds={frequentGenreIds}
                        value={value}
                        includeHidden={includeHidden}
                        onCategoryChange={onCategoryChange}
                        onPick={onPick}
                        comfortable={comfortable}
                    />
                )}
            </div>

            {!searching && hiddenCount > 0 && (
                <label
                    className={cn(
                        "bg-muted/50 text-muted-foreground flex items-center gap-2 border-t px-3 text-xs",
                        comfortable ? "py-3" : "py-2"
                    )}
                >
                    <Switch
                        size="sm"
                        checked={includeHidden}
                        onCheckedChange={onIncludeHiddenChange}
                        aria-label="隠した内訳も出す"
                    />
                    隠した内訳も出す（{hiddenCount}件）
                </label>
            )}
        </div>
    )
}

function CategoryBrowser({
    genres,
    groups,
    frequentGenreIds,
    value,
    includeHidden,
    onCategoryChange,
    onPick,
    comfortable,
}: {
    genres: ZaimGenreChoice[]
    groups: ReturnType<typeof groupGenresByCategory>
    frequentGenreIds: number[]
    value: number | null
    includeHidden: boolean
    onCategoryChange: (value: number | null) => void
    onPick: (genre: ZaimGenreChoice) => void
    comfortable: boolean
}) {
    const frequent = pickFrequentGenres(genres, frequentGenreIds)
    // 内訳をすべて隠した大分類は行ごと落とす。一覧を短くするのがこの機能の目的なので、
    // 押しても何も出ない行を残さない。落としたぶんは下の「隠した内訳も出す」で戻せる。
    const visibleGroups = includeHidden ? groups : groups.filter((group) => group.visibleCount > 0)

    return (
        <>
            {frequent.length > 0 && (
                <>
                    <SectionLabel comfortable={comfortable}>よく使う</SectionLabel>
                    <div
                        className={cn(
                            "flex flex-wrap px-3",
                            comfortable ? "gap-2 pb-3.5" : "gap-1.5 pb-2.5"
                        )}
                    >
                        {frequent.map((genre) => (
                            <button
                                key={genre.zaimGenreId}
                                type="button"
                                onClick={() => onPick(genre)}
                                className={cn(
                                    "hover:bg-accent rounded-full border transition-colors",
                                    comfortable ? "px-3.5 py-2 text-sm" : "px-2.5 py-1 text-xs",
                                    genre.zaimGenreId === value &&
                                        "bg-primary text-primary-foreground border-primary hover:bg-primary"
                                )}
                            >
                                <span
                                    className={
                                        genre.zaimGenreId === value
                                            ? "opacity-70"
                                            : "text-muted-foreground"
                                    }
                                >
                                    {genre.categoryName} /{" "}
                                </span>
                                {genre.genreName}
                            </button>
                        ))}
                    </div>
                </>
            )}

            <SectionLabel comfortable={comfortable}>大分類から選ぶ</SectionLabel>
            {visibleGroups.map((group) => (
                <button
                    key={group.zaimCategoryId}
                    type="button"
                    onClick={() => onCategoryChange(group.zaimCategoryId)}
                    className={cn(
                        "hover:bg-accent flex w-full items-center gap-2 border-t px-3 text-left transition-colors",
                        comfortable ? "py-3.5 text-base" : "py-2 text-sm",
                        group.visibleCount === 0 && "text-muted-foreground"
                    )}
                >
                    <span className="min-w-0 truncate">{group.categoryName}</span>
                    <span
                        className={cn(
                            "text-muted-foreground ml-auto tabular-nums",
                            comfortable ? "text-sm" : "text-xs"
                        )}
                    >
                        {group.visibleCount === group.genres.length
                            ? group.genres.length
                            : group.visibleCount + " / " + group.genres.length}
                    </span>
                    <ChevronRight
                        className={cn(
                            "text-muted-foreground/60 shrink-0",
                            comfortable ? "size-4" : "size-3.5"
                        )}
                    />
                </button>
            ))}
        </>
    )
}

function SearchResults({
    genres,
    query,
    value,
    onPick,
    comfortable,
}: {
    genres: ZaimGenreChoice[]
    query: string
    value: number | null
    onPick: (genre: ZaimGenreChoice) => void
    comfortable: boolean
}) {
    const matched = filterGenres(genres, query)
    const shown = matched.filter((genre) => !genre.hidden)
    // 検索では隠した内訳も必ず出す。名前で探しているのに出てこないと、消えたように見えるため。
    const hidden = matched.filter((genre) => genre.hidden)

    if (matched.length === 0) {
        return (
            <p className="text-muted-foreground px-3 py-8 text-center text-xs">
                「{query}」に一致する内訳はありません
            </p>
        )
    }

    return (
        <>
            {shown.length > 0 && (
                <>
                    <SectionLabel comfortable={comfortable}>{shown.length}件</SectionLabel>
                    <GenreList genres={shown} query={query} value={value} onPick={onPick} comfortable={comfortable} />
                </>
            )}
            {hidden.length > 0 && (
                <>
                    <SectionLabel comfortable={comfortable}>隠している内訳（{hidden.length}件）</SectionLabel>
                    <GenreList
                        genres={hidden}
                        query={query}
                        value={value}
                        onPick={onPick}
                        comfortable={comfortable}
                        muted
                    />
                </>
            )}
        </>
    )
}

function GenreList({
    genres,
    query,
    value,
    onPick,
    comfortable,
    showCategory = true,
    muted = false,
}: {
    genres: ZaimGenreChoice[]
    query: string
    value: number | null
    onPick: (genre: ZaimGenreChoice) => void
    comfortable: boolean
    showCategory?: boolean
    muted?: boolean
}) {
    return (
        <>
            {genres.map((genre) => (
                <button
                    key={genre.zaimGenreId}
                    type="button"
                    onClick={() => onPick(genre)}
                    className={cn(
                        "hover:bg-accent flex w-full items-center gap-2 border-t px-3 text-left transition-colors",
                        comfortable ? "py-3.5 text-base" : "py-2 text-sm",
                        muted && "text-muted-foreground",
                        genre.zaimGenreId === value && "bg-muted font-medium"
                    )}
                >
                    <span className="min-w-0 truncate">
                        <Highlight text={genre.genreName} query={query} />
                    </span>
                    {showCategory && (
                        <span
                            className={cn(
                                "text-muted-foreground ml-auto shrink-0",
                                comfortable ? "text-xs" : "text-[11px]"
                            )}
                        >
                            {genre.categoryName}
                        </span>
                    )}
                    {genre.zaimGenreId === value && (
                        <Check
                            className={cn(
                                comfortable ? "size-4" : "size-3.5",
                                "shrink-0",
                                showCategory ? "" : "ml-auto"
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
