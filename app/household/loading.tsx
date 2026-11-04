import { Skeleton } from "@/components/ui/skeleton"
import { PageLoadingShell } from "@/components/loading/page-skeleton"

/** 家計簿（タブ → 期間 → サマリー → カテゴリ別 → 一覧） */
export default function Loading() {
    return (
        <PageLoadingShell>
            <Skeleton className="h-9 w-64" />
            <Skeleton className="h-9 w-full max-w-md" />
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
                <Skeleton className="h-20" />
                <Skeleton className="h-20" />
                <Skeleton className="h-20" />
                <Skeleton className="h-20" />
            </div>
            <Skeleton className="h-40" />
            <Skeleton className="h-64" />
        </PageLoadingShell>
    )
}
