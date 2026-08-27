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

/** 枠の見出し行 */
export function SkeletonHeading({ className }: { className?: string }) {
    return <Skeleton className={cn("h-3.5 w-32", className)} />
}
