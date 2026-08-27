import { Skeleton } from "@/components/ui/skeleton"
import { PageLoadingShell, SkeletonHeading, SkeletonPanel } from "@/components/loading/page-skeleton"

/** リバランス（絞り込みの行 → サマリー4項目 → 現状と目標の対比 → 売買の一覧） */
export default function Loading() {
    return (
        <PageLoadingShell>
            <div className="flex flex-wrap items-center gap-2">
                <Skeleton className="h-8 w-56" />
                <div className="ml-auto flex items-center gap-2">
                    <Skeleton className="h-8 w-24" />
                    <Skeleton className="h-8 w-20" />
                </div>
            </div>

            <SkeletonPanel>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <Skeleton className="h-14" />
                    <Skeleton className="h-14" />
                    <Skeleton className="h-14" />
                    <Skeleton className="h-14" />
                </div>
            </SkeletonPanel>

            <SkeletonPanel>
                <SkeletonHeading className="w-40" />
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <Skeleton className="h-56" />
                    <Skeleton className="h-56" />
                </div>
            </SkeletonPanel>

            <SkeletonPanel>
                <SkeletonHeading className="w-36" />
                <Skeleton className="h-24" />
            </SkeletonPanel>
        </PageLoadingShell>
    )
}
