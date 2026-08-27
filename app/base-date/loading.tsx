import { Skeleton } from "@/components/ui/skeleton"
import { PageLoadingShell, SkeletonPanel } from "@/components/loading/page-skeleton"

/** 基準日比較（絞り込みが2行 → 資産ごとの増減の一覧） */
export default function Loading() {
    return (
        <PageLoadingShell>
            <SkeletonPanel className="gap-0 p-0">
                <div className="flex flex-col gap-2 border-b p-3">
                    <div className="flex items-center gap-2">
                        <Skeleton className="h-8 w-48" />
                        <Skeleton className="h-8 w-32" />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <Skeleton className="h-7 w-20" />
                        <Skeleton className="h-7 w-20" />
                        <Skeleton className="h-7 w-24" />
                        <Skeleton className="ml-auto h-7 w-28" />
                    </div>
                </div>

                <div className="flex flex-col divide-y">
                    <Skeleton className="m-3 h-10" />
                    <Skeleton className="m-3 h-10" />
                    <Skeleton className="m-3 h-10" />
                    <Skeleton className="m-3 h-10" />
                    <Skeleton className="m-3 h-10" />
                </div>
            </SkeletonPanel>
        </PageLoadingShell>
    )
}
