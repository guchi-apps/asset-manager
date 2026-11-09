import { Skeleton } from "@/components/ui/skeleton"
import { RouteLoadingSignal } from "@/components/route-loading-provider"
import { cn } from "@/lib/utils"

/**
 * `loading.tsx` の一番外側。
 * ページ本体と同じ余白で枠を並べつつ、ヘッダーへ「読み込み中」を知らせる。
 */
export function PageLoadingShell({
    className,
    children,
}: {
    className?: string
    children: React.ReactNode
}) {
    return (
        <div className={cn("flex flex-col gap-2 px-1 py-2 md:px-2 md:py-4", className)}>
            <RouteLoadingSignal />
            {children}
        </div>
    )
}

/** カード1枚ぶんの枠。中に {@link Skeleton} を並べて中身の形を作る */
export function SkeletonPanel({
    className,
    children,
}: {
    className?: string
    children: React.ReactNode
}) {
    return (
        <div className={cn("flex flex-col gap-3 rounded-xl border p-4", className)}>
            {children}
        </div>
    )
}

/** 日付ごとの明細カードの形（年月の切り替え中に、一覧の代わりに出す。#1266） */
export function EntryListSkeleton({ days = 3 }: { days?: number }) {
    return (
        <div className="flex flex-col gap-2.5" role="presentation">
            {Array.from({ length: days }, (_, day) => (
                <div key={day} className="overflow-hidden rounded-xl border">
                    <Skeleton className="h-10 rounded-none" />
                    {Array.from({ length: day === 0 ? 3 : 2 }, (_, row) => (
                        <div key={row} className="flex flex-col gap-2 border-t p-3.5">
                            <Skeleton className="h-5 w-24" />
                            <Skeleton className="h-3 w-3/5" />
                        </div>
                    ))}
                </div>
            ))}
        </div>
    )
}

/** カードを縦に並べた形（サマリー・分析の本体の代わりに出す。#1266） */
export function CardStackSkeleton() {
    return (
        <div className="flex flex-col gap-4" role="presentation">
            <div className="grid grid-cols-3 gap-2">
                <Skeleton className="h-14" />
                <Skeleton className="h-14" />
                <Skeleton className="h-14" />
            </div>
            <Skeleton className="h-44" />
            <Skeleton className="h-64" />
        </div>
    )
}

/** 枠の見出し行 */
export function SkeletonHeading({ className }: { className?: string }) {
    return <Skeleton className={cn("h-3.5 w-32", className)} />
}
