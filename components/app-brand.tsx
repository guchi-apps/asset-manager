import { Logo } from "@/components/Logo"
import { cn } from "@/lib/utils"

/**
 * 起動画面・ログイン画面で共通に使う背景。
 * アプリ本体と同じ無彩色トークンだけで組み、上からの光と下の影で奥行きを出す。
 */
export function AppBrandBackground() {
    return (
        <div aria-hidden className="pointer-events-none absolute inset-0">
            <div
                className="absolute inset-0"
                style={{
                    background:
                        "radial-gradient(115% 80% at 50% -12%, var(--muted) 0%, var(--background) 58%)",
                }}
            />
            <div
                className="absolute inset-0"
                style={{
                    background:
                        "radial-gradient(120% 70% at 50% 118%, color-mix(in oklab, var(--foreground) 6%, transparent) 0%, transparent 60%)",
                }}
            />
        </div>
    )
}

/** ロゴのタイル・アプリ名・説明文。起動画面とログイン画面で見た目をそろえるための共通部品。 */
export function AppBrandMark({ className }: { className?: string }) {
    return (
        <div className={cn("flex flex-col items-center gap-4", className)}>
            <div
                className="flex h-[76px] w-[76px] items-center justify-center rounded-[22px] border bg-muted"
                style={{
                    boxShadow:
                        "0 0 0 10px color-mix(in oklab, var(--foreground) 6%, transparent)",
                }}
            >
                <Logo className="h-[42px] w-[42px] text-foreground" />
            </div>
            <div className="flex flex-col items-center gap-1.5">
                <span className="text-xl font-semibold leading-none tracking-tight">
                    Asset Manager
                </span>
                <span className="text-[13px] text-muted-foreground">
                    資産の推移と構成を管理する
                </span>
            </div>
        </div>
    )
}

/** 画面下端に置くバージョン表記。起動画面とログイン画面で共通。 */
export function AppVersionFooter() {
    const version = process.env.NEXT_PUBLIC_APP_VERSION

    if (!version) return null

    return (
        <div className="absolute inset-x-0 bottom-6 text-center text-[11px] tracking-wider text-muted-foreground opacity-75">
            v{version}
        </div>
    )
}
