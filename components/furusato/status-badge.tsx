import { cn } from "@/lib/utils"
import {
    CERTIFICATE_STATUS_LABELS,
    ONE_STOP_STATUS_LABELS,
    type CertificateStatus,
    type OneStopStatus,
} from "@/lib/furusato/types"

// 「手を動かす必要がある状態」だけを警告色にする。受付待ち(applied)は自治体側の処理待ちなので
// 中間色、確定申告へ切替・証明書不要は意図した状態なので無彩色にしている。
const TONE = {
    attention: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    waiting: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    done: "border-emerald-600/40 bg-emerald-600/10 text-emerald-700 dark:text-emerald-300",
    neutral: "border-border bg-muted text-muted-foreground",
} as const

type Tone = keyof typeof TONE

const ONE_STOP_TONE: Record<OneStopStatus, Tone> = {
    notApplied: "attention",
    applied: "waiting",
    accepted: "done",
    switchedToTaxReturn: "neutral",
}

const CERTIFICATE_TONE: Record<CertificateStatus, Tone> = {
    notReceived: "attention",
    received: "done",
    notNeeded: "neutral",
}

function Badge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
    return (
        <span
            className={cn(
                "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium",
                TONE[tone]
            )}
        >
            <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden />
            {children}
        </span>
    )
}

export function OneStopStatusBadge({ status }: { status: OneStopStatus }) {
    return <Badge tone={ONE_STOP_TONE[status]}>{ONE_STOP_STATUS_LABELS[status]}</Badge>
}

export function CertificateStatusBadge({ status, withPrefix = false }: { status: CertificateStatus; withPrefix?: boolean }) {
    return (
        <Badge tone={CERTIFICATE_TONE[status]}>
            {withPrefix ? `証明書 ${CERTIFICATE_STATUS_LABELS[status]}` : CERTIFICATE_STATUS_LABELS[status]}
        </Badge>
    )
}
