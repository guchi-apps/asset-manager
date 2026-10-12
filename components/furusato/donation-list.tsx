"use client"

import Link from "next/link"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Pencil, Trash2 } from "lucide-react"
import { toast } from "sonner"

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { CertificateStatusBadge, OneStopStatusBadge } from "@/components/furusato/status-badge"
import { deleteFurusatoDonationAction } from "@/app/actions/furusato"
import { toDateInputValue, type FurusatoDonationDTO } from "@/lib/furusato/types"

function formatDay(iso: string | null): string {
    return iso ? toDateInputValue(iso).replaceAll("-", "/") : ""
}

/** 受け取り予定。片方だけのときは向きが分かる書き方にする */
export function formatReceiveRange(from: string | null, to: string | null): string {
    if (from && to) return from === to ? formatDay(from) : `${formatDay(from)} 〜 ${formatDay(to)}`
    if (from) return `${formatDay(from)} 〜`
    if (to) return `〜 ${formatDay(to)}`
    return "未設定"
}

function yen(amount: string): string {
    return `${Math.round(Number(amount)).toLocaleString()}円`
}

function DeleteButton({ donation }: { donation: FurusatoDonationDTO }) {
    const router = useRouter()
    const [deleting, setDeleting] = useState(false)

    async function handleDelete() {
        setDeleting(true)
        try {
            const result = await deleteFurusatoDonationAction(donation.id)
            if (!result.success) {
                toast.error(result.error)
                return
            }
            toast.success("削除しました")
            router.refresh()
        } finally {
            setDeleting(false)
        }
    }

    return (
        <AlertDialog>
            <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" disabled={deleting} aria-label={`${donation.municipality}の寄付を削除`}>
                    {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                    <span className="md:sr-only">削除</span>
                </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>寄付を削除しますか？</AlertDialogTitle>
                    <AlertDialogDescription>
                        {donation.municipality}（{yen(donation.amount)}）を削除します。この年の寄付額の合計からも外れます。
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={deleting}>キャンセル</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDelete} disabled={deleting}>
                        削除する
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}

function EditLink({ donation }: { donation: FurusatoDonationDTO }) {
    return (
        <Button asChild variant="ghost" size="sm">
            <Link href={`/furusato/${donation.id}/edit`} aria-label={`${donation.municipality}の寄付を編集`}>
                <Pencil className="size-4" />
                <span className="md:sr-only">編集</span>
            </Link>
        </Button>
    )
}

export function FurusatoDonationList({ donations, isFiltered }: { donations: FurusatoDonationDTO[]; isFiltered: boolean }) {
    if (donations.length === 0) {
        return (
            <p className="py-10 text-center text-sm text-muted-foreground">
                {isFiltered ? "この条件に当てはまる寄付はありません" : "この年の寄付はまだありません。「寄付を追加」から登録してください"}
            </p>
        )
    }

    return (
        <>
            {/* PC・iPad: 表 */}
            <div className="hidden md:block">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b text-left text-xs text-muted-foreground">
                            <th className="px-3 py-2 font-medium">寄付日</th>
                            <th className="px-3 py-2 font-medium">自治体 / 返礼品</th>
                            <th className="px-3 py-2 text-right font-medium">金額</th>
                            <th className="px-3 py-2 font-medium">ワンストップ</th>
                            <th className="px-3 py-2 font-medium">証明書</th>
                            <th className="px-3 py-2 font-medium">受取予定</th>
                            <th className="px-3 py-2" />
                        </tr>
                    </thead>
                    <tbody>
                        {donations.map((donation) => (
                            <tr key={donation.id} className="border-b align-top last:border-0">
                                <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">{formatDay(donation.donatedAt)}</td>
                                <td className="px-3 py-3">
                                    <p className="font-medium">{donation.municipality}</p>
                                    <p className="text-xs text-muted-foreground">
                                        {[donation.returnItem, donation.category, donation.portalSite].filter(Boolean).join("・")}
                                    </p>
                                    {donation.memo && <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{donation.memo}</p>}
                                </td>
                                <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums">{yen(donation.amount)}</td>
                                <td className="px-3 py-3"><OneStopStatusBadge status={donation.oneStopStatus} /></td>
                                <td className="px-3 py-3"><CertificateStatusBadge status={donation.certificateStatus} /></td>
                                <td className="px-3 py-3 text-xs text-muted-foreground">{formatReceiveRange(donation.receiveFrom, donation.receiveTo)}</td>
                                <td className="whitespace-nowrap px-1 py-2 text-right">
                                    <EditLink donation={donation} />
                                    <DeleteButton donation={donation} />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* スマホ: カード */}
            <ul className="divide-y md:hidden">
                {donations.map((donation) => (
                    <li key={donation.id} className="flex flex-col gap-2 py-3">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <p className="font-medium">{donation.municipality}</p>
                                <p className="break-words text-xs text-muted-foreground">
                                    {formatDay(donation.donatedAt)}
                                    {donation.returnItem ? `・${donation.returnItem}` : ""}
                                </p>
                            </div>
                            <p className="shrink-0 font-semibold tabular-nums">{yen(donation.amount)}</p>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            <OneStopStatusBadge status={donation.oneStopStatus} />
                            <CertificateStatusBadge status={donation.certificateStatus} withPrefix />
                        </div>
                        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                            <span>受取 {formatReceiveRange(donation.receiveFrom, donation.receiveTo)}</span>
                            <span className="flex">
                                <EditLink donation={donation} />
                                <DeleteButton donation={donation} />
                            </span>
                        </div>
                    </li>
                ))}
            </ul>
        </>
    )
}
