"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { toast } from "sonner"

import { decideSalaryAgentApproval } from "@/app/actions/salary-agent-approval"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type Props = {
    previewId: string
    /** 支給日の初期値（PDFの年月と前回の支給日から推測した候補） */
    initialSalaryDate: string
    /** 明細の年月（yyyy-MM）。日付欄をこの月に絞る */
    month: string | null
    canApprove: boolean
}

/** 支給日を確定して承認する、または却下する。決めたあとは画面を読み直して結果を出す */
export function AgentApprovalForm({ previewId, initialSalaryDate, month, canApprove }: Props) {
    const router = useRouter()
    const [salaryDate, setSalaryDate] = useState(initialSalaryDate)
    const [isPending, startTransition] = useTransition()

    const decide = (decision: "approve" | "reject") => {
        startTransition(async () => {
            const result = await decideSalaryAgentApproval(previewId, decision, salaryDate)
            if (result.success) {
                toast.success(decision === "approve" ? "承認しました" : "却下しました")
            } else {
                toast.error(result.error)
            }
            router.refresh()
        })
    }

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 gap-1.5 sm:max-w-xs">
                <Label htmlFor="salary-date">支給日（この日付で保存されます）</Label>
                <Input
                    id="salary-date"
                    type="date"
                    value={salaryDate}
                    min={month ? `${month}-01` : undefined}
                    max={month ? `${month}-31` : undefined}
                    onChange={(event) => setSalaryDate(event.target.value)}
                    disabled={!canApprove || isPending}
                />
            </div>
            <div className="flex flex-wrap gap-2">
                <Button onClick={() => decide("approve")} disabled={!canApprove || isPending || salaryDate === ""}>
                    承認する
                </Button>
                <Button variant="outline" onClick={() => decide("reject")} disabled={isPending}>
                    却下する
                </Button>
            </div>
        </div>
    )
}
