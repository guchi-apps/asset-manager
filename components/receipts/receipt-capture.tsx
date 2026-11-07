"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Camera, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { canUseReceiptsAction, uploadReceiptAction } from "@/app/actions/receipts"
import { Button } from "@/components/ui/button"
import { fitWithin, needsResize } from "@/lib/receipt-image-resize"

/** 写真をCanvasでJPEGに縮める。読み込めない形式（HEICなど）は元のファイルのまま返す。 */
async function shrinkImage(file: File): Promise<File> {
    try {
        const bitmap = await createImageBitmap(file)
        try {
            if (!needsResize(file, { width: bitmap.width, height: bitmap.height })) return file
            const { width, height } = fitWithin({ width: bitmap.width, height: bitmap.height })
            const canvas = document.createElement("canvas")
            canvas.width = width
            canvas.height = height
            const context = canvas.getContext("2d")
            if (!context) return file
            context.drawImage(bitmap, 0, 0, width, height)
            const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85))
            if (!blob) return file
            return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" })
        } finally {
            bitmap.close()
        }
    } catch {
        return file
    }
}

/**
 * レシート写真の取り込み（Issue #975）。写真を選ぶ → 縮小 → AIが読み取る → 確認画面へ移動、までを受け持つ。
 * 非表示の `<input>` は呼び出し側が `input` を画面のどこかに置く（選択ダイアログを開く間、消えない場所に置くこと）。
 */
export function useReceiptCapture(onDone?: () => void) {
    const router = useRouter()
    const inputRef = React.useRef<HTMLInputElement>(null)
    const [busy, setBusy] = React.useState(false)

    const open = React.useCallback(() => inputRef.current?.click(), [])

    const onChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const picked = event.target.files?.[0]
        event.target.value = ""
        if (!picked) return
        setBusy(true)
        try {
            const file = await shrinkImage(picked)
            const formData = new FormData()
            formData.set("image", file)
            const result = await uploadReceiptAction(formData)
            if (!result.success) {
                toast.error(result.error)
                return
            }
            if (result.data.duplicate) toast.info("同じ写真は取り込み済みです。既存の明細を開きます")
            onDone?.()
            router.push("/receipts/" + result.data.receiptId)
        } catch {
            toast.error("レシートの取り込みに失敗しました。通信状況を確かめて、もう一度お試しください")
        } finally {
            setBusy(false)
        }
    }

    const input = (
        <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => void onChange(event)}
            aria-label="レシートの写真"
        />
    )
    return { busy, open, input }
}

/** PC・iPad向けの「レシートから読み込む」ボタン。使えないアカウントでは何も出さない */
export function ReceiptCaptureButton({ className }: { className?: string }) {
    const [allowed, setAllowed] = React.useState(false)
    const { busy, open, input } = useReceiptCapture()
    React.useEffect(() => {
        void canUseReceiptsAction().then(setAllowed, () => setAllowed(false))
    }, [])
    if (!allowed) return null
    return (
        <>
            {input}
            <Button size="sm" variant="outline" className={className} onClick={open} disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <Camera />}
                {busy ? "読み取り中…" : "レシートから読み込む"}
            </Button>
        </>
    )
}
