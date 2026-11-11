import { Skeleton } from "@/components/ui/skeleton"
import { PageLoadingShell } from "@/components/loading/page-skeleton"

/** 定期払いの詳細（戻る行 → 見出し → 項目 → 履歴） */
export default function Loading() {
    return (
        <PageLoadingShell>
            <Skeleton className="h-9 w-40" />
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-48" />
            <Skeleton className="h-40" />
        </PageLoadingShell>
    )
}
