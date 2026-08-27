import { Skeleton } from "@/components/ui/skeleton"
import { PageLoadingShell, SkeletonHeading, SkeletonPanel } from "@/components/loading/page-skeleton"

/** レシート取込（中央寄せ1カラム。設定 → 撮影ボタン → 取り込んだレシートの一覧） */
export default function Loading() {
    return (
        <PageLoadingShell className="mx-auto w-full max-w-3xl gap-4 p-4 pb-24 md:p-4">
            <SkeletonPanel>
                <SkeletonHeading className="w-28" />
                <div className="grid grid-cols-2 gap-3">
                    <Skeleton className="h-14" />
                    <Skeleton className="h-14" />
                </div>
            </SkeletonPanel>

            <SkeletonPanel>
                <Skeleton className="h-16 w-full" />
                <Skeleton className="mx-auto h-3 w-48" />
            </SkeletonPanel>

            <SkeletonPanel>
                <SkeletonHeading className="w-32" />
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
            </SkeletonPanel>
        </PageLoadingShell>
    )
}
