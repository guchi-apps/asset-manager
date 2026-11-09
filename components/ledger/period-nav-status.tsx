"use client"

import * as React from "react"
import Link, { useLinkStatus } from "next/link"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * 年月（期間）の切り替え中であることを、押した場所・見出し・一覧へ伝える（Issue #1266）。
 *
 * 同じ `/ledger` のまま `?offset=` だけが変わる遷移は、セグメントが変わらないため `loading.tsx` が出ず、
 * 新しいデータが届くまで古い画面が残る。ボタンを押しても何も起きていないように見えるので、
 * `<Link>` の保留（`useLinkStatus`）と `router.push` の保留（`useTransition`）をここへ集める。
 *
 * すぐ終わる切り替えで点滅しないよう、見た目を変えるのは {@link SHOW_DELAY_MS} を超えてから。
 * 連打を防ぐため、保留中の {@link PeriodNavLink} は押せなくする（こちらは即時）。
 */
const SHOW_DELAY_MS = 150

type PeriodNavValue = {
    /** 切り替えが始まってからの経過に関わらず、保留中か */
    busy: boolean
    /** 保留が {@link SHOW_DELAY_MS} を超えて、読み込み中の見た目を出す段階か */
    shown: boolean
    beginLink: () => () => void
    navigate: (href: string) => void
}

const PeriodNavContext = React.createContext<PeriodNavValue | null>(null)

export function PeriodNavProvider({ children }: { children: React.ReactNode }) {
    const router = useRouter()
    const [isTransitioning, startTransition] = React.useTransition()
    const [linkCount, setLinkCount] = React.useState(0)
    const [shown, setShown] = React.useState(false)

    const beginLink = React.useCallback(() => {
        setLinkCount((count) => count + 1)
        return () => setLinkCount((count) => Math.max(0, count - 1))
    }, [])
    const navigate = React.useCallback(
        (href: string) => startTransition(() => router.push(href, { scroll: false })),
        [router]
    )

    const busy = linkCount > 0 || isTransitioning
    React.useEffect(() => {
        if (!busy) {
            setShown(false)
            return
        }
        const timer = setTimeout(() => setShown(true), SHOW_DELAY_MS)
        return () => clearTimeout(timer)
    }, [busy])

    const value = React.useMemo(() => ({ busy, shown, beginLink, navigate }), [busy, shown, beginLink, navigate])
    return <PeriodNavContext.Provider value={value}>{children}</PeriodNavContext.Provider>
}

/** 外側に {@link PeriodNavProvider} が無くても落ちない（何も出さず、普通に遷移する） */
export function usePeriodNav(): PeriodNavValue {
    const router = useRouter()
    const ctx = React.useContext(PeriodNavContext)
    return (
        ctx ?? {
            busy: false,
            shown: false,
            beginLink: () => () => {},
            navigate: (href) => router.push(href, { scroll: false }),
        }
    )
}

/** `<Link>` の子として置き、そのリンクが保留中のあいだ切り替え中を知らせる。`spinner` なら中身をスピナーにする */
function LinkPendingStatus({ spinner, children }: { spinner?: boolean; children: React.ReactNode }) {
    const { pending } = useLinkStatus()
    const { shown, beginLink } = usePeriodNav()

    React.useEffect(() => (pending ? beginLink() : undefined), [pending, beginLink])

    if (spinner && pending && shown) return <Loader2 className="animate-spin" aria-hidden />
    return <>{children}</>
}

/**
 * 年月を動かす `<Link>`。保留中は自分も他のリンクも押せなくする。
 * `Button asChild` の子にしてよい（props をそのまま `Link` へ渡す）。
 */
export function PeriodNavLink({
    spinner,
    children,
    className,
    onClick,
    tabIndex,
    ...props
}: React.ComponentProps<typeof Link> & { spinner?: boolean }) {
    const { busy } = usePeriodNav()
    return (
        <Link
            {...props}
            aria-disabled={busy || undefined}
            tabIndex={busy ? -1 : tabIndex}
            className={cn(className, busy && "pointer-events-none")}
            onClick={(event) => {
                if (busy) {
                    event.preventDefault()
                    return
                }
                onClick?.(event)
            }}
        >
            <LinkPendingStatus spinner={spinner}>{children}</LinkPendingStatus>
        </Link>
    )
}

/** 期間バーの下の細い進捗線。切り替え中でなければ高さだけ残して何も出さない（レイアウトを動かさない） */
export function PeriodNavProgress({ className }: { className?: string }) {
    const { shown } = usePeriodNav()
    return (
        <div className={cn("h-0.5 overflow-hidden rounded-full", shown && "bg-muted", className)}>
            {shown && (
                <>
                    <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
                    <span role="status" className="sr-only">
                        読み込み中
                    </span>
                </>
            )}
        </div>
    )
}

/** 切り替え中は `fallback`（スケルトン）に差し替える。それまでは中身をそのまま出す */
export function PeriodNavBody({ fallback, children }: { fallback: React.ReactNode; children: React.ReactNode }) {
    const { shown } = usePeriodNav()
    return (
        <div aria-busy={shown || undefined} className="contents">
            {shown ? fallback : children}
        </div>
    )
}
