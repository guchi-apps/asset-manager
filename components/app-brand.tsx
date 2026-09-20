import Image from "next/image"
import { cn } from "@/lib/utils"

/**
 * 起動画面・ログイン画面で共通に使う背景。
 * アプリのアクセント（--primary＝アイコンの橙）を、上からの光と下の残光として重ねる。
 */
export function AppBrandBackground() {
    return (
        <div aria-hidden className="pointer-events-none absolute inset-0">
            <div
                className="absolute inset-0"
                style={{
                    background:
                        "radial-gradient(90% 62% at 50% -10%, color-mix(in oklab, var(--primary) 26%, transparent) 0%, transparent 66%)",
                }}
            />
            <div
                className="absolute inset-0"
                style={{
                    background:
                        "radial-gradient(120% 70% at 50% 120%, color-mix(in oklab, var(--primary) 12%, transparent) 0%, transparent 62%)",
                }}
            />
        </div>
    )
}

/** アイコン・アプリ名・説明文。起動画面とログイン画面で見た目をそろえるための共通部品。 */
export function AppBrandMark({ className }: { className?: string }) {
    return (
        <div className={cn("flex flex-col items-center gap-4", className)}>
            {/* アプリアイコン（public/icon.svg）をそのまま出す。ホーム画面・サイドバーと同じ絵になる */}
            <Image
                src="/icon.svg"
                alt=""
                width={76}
                height={76}
                priority
                className="h-[76px] w-[76px] rounded-[19px]"
                style={{
                    boxShadow:
                        "0 0 0 10px color-mix(in oklab, var(--primary) 16%, transparent), 0 10px 26px -6px color-mix(in oklab, var(--primary) 55%, transparent)",
                }}
            />
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
