"use client"

import { Plus } from "lucide-react"
import { useRouter } from "next/navigation"
import { useShellPathname } from "@/components/shell-pathname-provider"

/**
 * ヘッダー右上の「取引を追加」アイコン（Issue #1611）。家計簿の本体（`/ledger`）にだけ出す。
 * スマホは下部ナビ（BottomNav）の「追加」があるので md 以上だけ。押すと下部ナビと同じ
 * `/ledger?add=1` へ遷移し、家計簿側が新規取引ダイアログを開く（口座が無ければ案内を出す）。
 */
export function HeaderLedgerAddLink() {
    const pathname = useShellPathname()
    const router = useRouter()
    if (pathname !== "/ledger") return null

    return (
        <button
            type="button"
            aria-label="取引を追加"
            title="取引を追加"
            onClick={() => router.push("/ledger?add=1")}
            className="hidden size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:inline-flex"
        >
            <Plus className="size-5" />
        </button>
    )
}
