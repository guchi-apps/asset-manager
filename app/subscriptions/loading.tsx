import { Skeleton } from "@/components/ui/skeleton"
import { PageLoadingShell, SkeletonPanel } from "@/components/loading/page-skeleton"

/** サブスク（タブ → サマリー4枚 → 絞り込みの行 → 一覧） */
export default function Loading() {
    return (
        <PageLoadingShell>
            <Skeleton className="h-9 w-64" />

            <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
                <Skeleton className="h-20" />
                <Skeleton className="h-20" />
                <Skeleton className="h-20" />
                <Skeleton className="h-20" />
            </div>

            <div className="flex flex-wrap items-center gap-2">
                <Skeleton className="h-9 w-56" />
                <Skeleton className="h-9 w-40" />
                <Skeleton className="ml-auto h-9 w-28" />
            </div>

            <SkeletonPanel>
                <Skeleton className="h-64" />
            </SkeletonPanel>
        </PageLoadingShell>
    )
}
