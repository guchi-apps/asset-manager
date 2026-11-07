"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, Check, Copy, RotateCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
    CHUNK_RELOAD_STORAGE_KEY,
    errorDetailRows,
    explainError,
    formatErrorDetails,
    shouldAutoReload,
} from "@/lib/error-explain"
import { cn } from "@/lib/utils"

type Props = {
    error: Error & { digest?: string }
    /** 「もう一度試す」。再読み込みせずに、エラーになった範囲だけ描き直す */
    onRetry: () => void
    /** 見出し。ページ単位とアプリ全体で変える */
    title: string
    /** 「ダッシュボードへ」を出すか（ナビが無い global-error では出さない） */
    showHomeLink?: boolean
    className?: string
}

function readLastReloadAt(): number | null {
    try {
        const raw = window.sessionStorage.getItem(CHUNK_RELOAD_STORAGE_KEY)
        return raw === null ? null : Number(raw)
    } catch {
        return null
    }
}

function writeLastReloadAt(value: number) {
    try {
        window.sessionStorage.setItem(CHUNK_RELOAD_STORAGE_KEY, String(value))
    } catch {
        // 保存できない（プライベートブラウズ等）なら自動再読み込みは1回きりにならないため、試さない側へ倒す
    }
}

function formatNow(): string {
    return new Intl.DateTimeFormat("ja-JP", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    }).format(new Date())
}

/** 画面を読み込み直す。アプリを閉じて開き直すのと同じ状態にする */
export function restartApp() {
    window.location.reload()
}

/**
 * 描画中のエラーを受け止めたときに出すカード（Issue #1089）。
 * 原因を日本語で説明し、「アプリを再起動」「もう一度試す」を出す。元の英語の内容は「詳しい情報」に畳む。
 */
export function ErrorFallback({ error, onRetry, title, showHomeLink = false, className }: Props) {
    const explanation = useMemo(() => explainError(error), [error])
    const pathname = usePathname()
    // エラーを受け止めた時刻。描き直しのたびに変わらないよう、最初の1回だけ求める
    const [occurredAt] = useState(formatNow)
    const [copied, setCopied] = useState(false)
    const [reloading, setReloading] = useState(false)

    useEffect(() => {
        console.error(error)

        // アプリ更新直後の読み込み失敗は、開き直せば新しい版で直る。ループしないよう、直近に試していなければ1回だけ
        const now = Date.now()
        if (shouldAutoReload(explanation.kind, readLastReloadAt(), now)) {
            // 保存できない環境で再読み込みを繰り返さないよう、書けたことを確かめてから再読み込みする
            writeLastReloadAt(now)
            if (readLastReloadAt() === now) restartApp()
        }
    }, [error, explanation.kind])

    const rows = errorDetailRows(error, { pathname: pathname ?? undefined, occurredAt, version: process.env.NEXT_PUBLIC_APP_VERSION })

    const restart = () => {
        setReloading(true)
        restartApp()
    }

    const copyDetails = async () => {
        try {
            await navigator.clipboard.writeText(formatErrorDetails(rows))
            setCopied(true)
            window.setTimeout(() => setCopied(false), 2000)
        } catch {
            setCopied(false)
        }
    }

    return (
        <div
            role="alert"
            className={cn(
                "w-full max-w-xl rounded-xl border bg-card p-5 text-card-foreground shadow-sm sm:p-6",
                className,
            )}
        >
            <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <AlertTriangle className="size-5" aria-hidden />
            </div>

            <span className="mb-2 inline-block rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
                {explanation.label}
            </span>
            <h2 className="mb-1.5 text-lg font-semibold">{title}</h2>
            <p className="mb-1.5 text-sm">{explanation.cause}</p>
            <p className="text-[13px] text-muted-foreground">
                入力済みのデータは失われていません。{explanation.advice}
            </p>

            <div className="mt-4 flex flex-col gap-2">
                <Button size="lg" className="h-11 text-[15px]" onClick={restart} disabled={reloading}>
                    <RotateCw className={cn(reloading && "animate-spin")} aria-hidden />
                    {reloading ? "再起動しています…" : "アプリを再起動"}
                </Button>
                <div className={cn("grid gap-2", showHomeLink ? "grid-cols-2" : "grid-cols-1")}>
                    <Button variant="outline" size="lg" className="h-11" onClick={onRetry}>
                        もう一度試す
                    </Button>
                    {showHomeLink && (
                        <Button variant="outline" size="lg" className="h-11" asChild>
                            <Link href="/">ダッシュボードへ</Link>
                        </Button>
                    )}
                </div>
            </div>

            {explanation.kind === "chunk" && (
                <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                    このエラーは通常、自動で1回だけ再読み込みして直します。それでも出たときだけこの画面になります。
                </p>
            )}

            <details className="mt-4 border-t pt-3 text-[13px]">
                <summary className="cursor-pointer font-semibold text-muted-foreground">詳しい情報</summary>
                <dl className="mt-2 space-y-0.5 break-all rounded-lg bg-muted p-3 font-mono text-xs">
                    {rows.map((row) => (
                        <div key={row.label} className="flex gap-2">
                            <dt className="shrink-0 text-muted-foreground">{row.label}:</dt>
                            <dd className="min-w-0" suppressHydrationWarning>{row.value}</dd>
                        </div>
                    ))}
                </dl>
                <Button variant="outline" size="xs" className="mt-2" onClick={copyDetails}>
                    {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                    {copied ? "コピーしました" : "内容をコピー"}
                </Button>
            </details>
        </div>
    )
}
