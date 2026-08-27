import { Skeleton } from "@/components/ui/skeleton"
import { PageLoadingShell, SkeletonHeading, SkeletonPanel } from "@/components/loading/page-skeleton"

/** ダッシュボード（サマリー4項目 → 推移グラフ → 構成） */
export default function Loading() {
    return (
        <PageLoadingShell>
            <SkeletonPanel>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <Skeleton className="h-12" />
                    <Skeleton className="h-12" />
                    <Skeleton className="h-12" />
                    <Skeleton className="h-12" />
                </div>
            </SkeletonPanel>

            <SkeletonPanel>
                <SkeletonHeading />
                <Skeleton className="h-72" />
            </SkeletonPanel>

            <SkeletonPanel>
                <SkeletonHeading className="w-40" />
                <Skeleton className="h-56" />
            </SkeletonPanel>
        </PageLoadingShell>
    )
}
