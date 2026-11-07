"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { uploadReceiptAction } from "@/app/actions/receipts"
import { ReceiptCamera } from "@/components/receipts/receipt-camera"
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
 * レシート写真の取り込み（Issue #975）。撮る・選ぶ → 縮小 → AIが読み取る → 確認画面へ移動、までを受け持つ。
 * `open` でアプリ内のカメラ画面（Issue #1087）を開く。呼び出し側は `element` を画面のどこかに置く。
 */
export function useReceiptCapture(onDone?: () => void) {
    const router = useRouter()
    const [cameraOpen, setCameraOpen] = React.useState(false)
    const [busy, setBusy] = React.useState(false)

    const open = React.useCallback(() => setCameraOpen(true), [])

    const submit = async (picked: File) => {
        if (busy) return
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
            setCameraOpen(false)
            onDone?.()
            router.push("/receipts/" + result.data.receiptId)
        } catch {
            toast.error("レシートの取り込みに失敗しました。通信状況を確かめて、もう一度お試しください")
        } finally {
            setBusy(false)
        }
    }

    const element = <ReceiptCamera open={cameraOpen} onOpenChange={setCameraOpen} busy={busy} onSubmit={(file) => void submit(file)} />
    return { busy, open, element }
}
