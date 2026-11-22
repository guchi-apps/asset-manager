import { formatDate, formatYen } from "@/components/ledger/format"
import type { RewardProgress } from "@/lib/card-reward"

/** 口座タブのカードに出す、カード特典の年度の進捗バー（#1532） */
export function RewardProgressBar({ reward }: { reward: RewardProgress }) {
    return (
        <div className="flex flex-col gap-0.5 border-t pt-1.5">
            <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="text-muted-foreground">特典</span>
                <span className="tabular-nums">
                    {formatYen(reward.used)} / {formatYen(reward.target)}
                </span>
            </div>
            <Bar percent={reward.percent} />
            <span className="text-xs text-muted-foreground">
                {reward.remaining > 0 ? `残り ${formatYen(reward.remaining)}` : "目標を達成"}・{formatDate(reward.start)}〜{formatDate(reward.end)}
            </span>
        </div>
    )
}

/** 口座の詳細画面の上部に出す、カード特典の進捗カード（#1532） */
export function RewardProgressCard({ reward }: { reward: RewardProgress }) {
    return (
        <section className="flex flex-col gap-2 rounded-lg border bg-card p-4 shadow-xs" aria-label="カード特典の進捗">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h2 className="text-sm font-semibold">カード特典の進捗</h2>
                <span className="text-xs text-muted-foreground">
                    {formatDate(reward.start)}〜{formatDate(reward.end)}
                </span>
            </div>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="flex min-w-0 flex-col">
                    <dt className="text-xs text-muted-foreground">対象の利用額（{reward.countedCount}件）</dt>
                    <dd className="text-xl font-semibold tabular-nums">{formatYen(reward.used)}</dd>
                </div>
                <div className="flex min-w-0 flex-col">
                    <dt className="text-xs text-muted-foreground">{formatYen(reward.target)}まで残り</dt>
                    <dd className="text-xl font-semibold tabular-nums">{reward.remaining > 0 ? formatYen(reward.remaining) : "達成"}</dd>
                </div>
                <div className="flex min-w-0 flex-col">
                    <dt className="text-xs text-muted-foreground">対象外として除いた額（{reward.excludedCount}件）</dt>
                    <dd className="text-xl font-semibold tabular-nums">{formatYen(reward.excluded)}</dd>
                </div>
            </dl>
            <Bar percent={reward.percent} />
            <p className="text-xs text-muted-foreground">
                確定した支出だけを数えます（反映待ちは含みません）。売上票の到着が期間後にずれた分などは公式の累計と合わないことがあるため、正しい累計はカード会社のアプリ（Vpassなど）で確認してください。対象外の判定は下の取引ごとに切り替えられます。
            </p>
        </section>
    )
}

function Bar({ percent }: { percent: number }) {
    return (
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
            <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
        </div>
    )
}
