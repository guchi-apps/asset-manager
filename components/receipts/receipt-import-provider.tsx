"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { getReceiptBatchAction, retryReceiptAnalysisAction, uploadReceiptAction } from "@/app/actions/receipts"
import { ReceiptCamera, type ReceiptCaptureMode } from "@/components/receipts/receipt-camera"
import { ReceiptImportTray } from "@/components/receipts/receipt-import-tray"
import { formatYen } from "@/components/receipts/receipt-status"
import { useShellPathname } from "@/components/shell-pathname-provider"
import { fitWithin, needsResize } from "@/lib/receipt-image-resize"
import {
    batchPhase,
    isBatchFinished,
    nextBatchReceiptId,
    summarizeBatch,
    type ReceiptBatchItem,
    type ReceiptBatchSummary,
} from "@/lib/receipt-import-batch"
import { buildReceiptDetailPath, pickReturnFrom, RECEIPT_LIST_PATH, resolveReturnPath } from "@/lib/receipt-return-path"

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

/** 今回撮ったまとまり。撮影を始めた画面（`from`）へ、全件を確認し終えたら戻す（#1297）。 */
interface StoredBatch {
    ids: number[]
    from: string | null
}

const STORAGE_KEY = "asset-manager:receipt-import-batch"
/** 解析中・送信中の間に状態を読み直す間隔 */
const POLL_MS = 3000

function loadBatch(): StoredBatch {
    try {
        const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as StoredBatch | null
        if (parsed && Array.isArray(parsed.ids)) return { ids: parsed.ids.filter((id) => Number.isInteger(id)), from: parsed.from ?? null }
    } catch {
        // 読めなければ空のまま始める
    }
    return { ids: [], from: null }
}

function saveBatch(batch: StoredBatch): void {
    try {
        if (batch.ids.length === 0) window.localStorage.removeItem(STORAGE_KEY)
        else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(batch))
    } catch {
        // 保存できなくても、この画面を開いている間は使える
    }
}

interface ReceiptImportContextValue {
    /** カメラ画面を開く */
    openCamera: () => void
    /** 今回のまとまり（撮った順）。削除済みの明細は含まない */
    items: ReceiptBatchItem[]
    ids: number[]
    summary: ReceiptBatchSummary
    /** 状態を読み直す（登録・削除の直後など） */
    refresh: () => Promise<void>
    /** まとまりの表示を閉じる（明細はそのまま残る） */
    dismiss: () => void
    /** 読み取り直す */
    retry: (id: number) => Promise<void>
    /** 次に確認する明細へ移る。無ければ撮影を始めた画面へ戻ってまとまりを片付ける */
    goNext: (afterId: number | null) => Promise<void>
}

const ReceiptImportContext = React.createContext<ReceiptImportContextValue | null>(null)

/**
 * レシートの連続取り込み（Issue #1517）。撮った写真を順に送り、AIの解析はサーバーが応答後に続ける。
 * 今回のまとまりの状態を読み直し続け、取り込みトレイ・確認画面の並びへ渡す。カメラ画面もここに1つだけ置く。
 */
export function ReceiptImportProvider({ children }: { children: React.ReactNode }) {
    const router = useRouter()
    const pathname = useShellPathname()
    const [batch, setBatch] = React.useState<StoredBatch>({ ids: [], from: null })
    const [items, setItems] = React.useState<ReceiptBatchItem[]>([])
    const [uploading, setUploading] = React.useState(0)
    /** `items` がどのまとまり（idの並び）を読んだ結果か */
    const [loadedKey, setLoadedKey] = React.useState("")
    const [cameraOpen, setCameraOpen] = React.useState(false)
    /** カメラを開いてから送った枚数（カメラ画面の表示用） */
    const [sentInCamera, setSentInCamera] = React.useState(0)
    const queue = React.useRef<Promise<void>>(Promise.resolve())
    const batchRef = React.useRef(batch)
    const previous = React.useRef(new Map<number, string>())

    React.useEffect(() => {
        const stored = loadBatch()
        batchRef.current = stored
        setBatch(stored)
    }, [])

    const updateBatch = React.useCallback((next: (current: StoredBatch) => StoredBatch) => {
        const value = next(batchRef.current)
        batchRef.current = value
        saveBatch(value)
        setBatch(value)
    }, [])

    const refresh = React.useCallback(async () => {
        const ids = batchRef.current.ids
        if (ids.length === 0) {
            setItems([])
            return
        }
        const result = await getReceiptBatchAction(ids).catch(() => null)
        if (!result?.success) return
        // 解析が終わったものを知らせる（この画面を開く前に終わっていたものは知らせない）
        for (const item of result.data) {
            const before = previous.current.get(item.id)
            if (before === "ANALYZING" && item.status !== "ANALYZING") {
                const open = () => router.push(buildReceiptDetailPath(item.id, null))
                if (item.status === "FAILED") {
                    toast.error("レシートを読み取れませんでした", { description: item.analysisError ?? undefined, action: { label: "開く", onClick: open } })
                } else {
                    toast.success(`${item.storeName ?? "店舗名なし"} ${formatYen(item.totalAmount)} を読み取りました`, { action: { label: "確認する", onClick: open } })
                }
            }
            previous.current.set(item.id, item.status)
        }
        setItems(result.data)
        setLoadedKey(ids.join(","))
    }, [router])

    // まとまりが変わったら読み直す。画面を移ったとき・アプリへ戻ったときも読み直す（登録・削除の反映）
    React.useEffect(() => {
        void refresh()
    }, [batch.ids, pathname, refresh])
    React.useEffect(() => {
        const onVisible = () => document.visibilityState === "visible" && void refresh()
        document.addEventListener("visibilitychange", onVisible)
        return () => document.removeEventListener("visibilitychange", onVisible)
    }, [refresh])

    const summary = summarizeBatch(items, uploading)
    const waiting = uploading > 0 || items.some((item) => batchPhase(item) === "analyzing")
    React.useEffect(() => {
        if (!waiting) return
        const timer = window.setInterval(() => void refresh(), POLL_MS)
        return () => window.clearInterval(timer)
    }, [waiting, refresh])

    // 全件を登録・削除し終えたら片付ける。今のまとまりの状態を読み終えてから判定する（送った直後に消さない）
    React.useEffect(() => {
        if (batch.ids.length === 0 || loadedKey !== batch.ids.join(",")) return
        if (isBatchFinished(batch.ids, items, uploading)) updateBatch(() => ({ ids: [], from: null }))
    }, [batch.ids, items, uploading, loadedKey, updateBatch])

    const enqueue = React.useCallback(
        (picked: File, mode: ReceiptCaptureMode = "multi") => {
            setUploading((n) => n + 1)
            setSentInCamera((n) => n + 1)
            // 撮影を始めた画面を覚えておき、全件を確認し終えたらそこへ戻す（#1297）
            const from = pickReturnFrom(window.location.pathname + window.location.search)
            // 回線を取り合わないよう、送信は1枚ずつ順に行う（解析はサーバー側で並行して進む）
            queue.current = queue.current.then(async () => {
                try {
                    const file = await shrinkImage(picked)
                    const formData = new FormData()
                    formData.set("image", file)
                    const result = await uploadReceiptAction(formData)
                    if (!result.success) {
                        toast.error(result.error)
                        return
                    }
                    if (result.data.duplicate) toast.info("同じ写真は取り込み済みです。既存の明細をまとまりに加えました")
                    const id = result.data.receiptId
                    if (result.data.status === "ANALYZING") previous.current.set(id, "ANALYZING")
                    updateBatch((current) => ({
                        ids: current.ids.includes(id) ? current.ids : [...current.ids, id],
                        from: current.ids.length === 0 ? from : current.from,
                    }))
                    // 「1枚」は送れたらカメラを閉じて、そのレシートの確認画面へ進む（#1620）
                    if (mode === "single") {
                        setCameraOpen(false)
                        router.push(buildReceiptDetailPath(id, null))
                    }
                } catch {
                    toast.error("レシートを送れませんでした。通信状況を確かめて、もう一度撮ってください")
                } finally {
                    setUploading((n) => n - 1)
                }
            })
        },
        [updateBatch, router]
    )

    const openCamera = React.useCallback(() => {
        setSentInCamera(0)
        setCameraOpen(true)
    }, [])

    const dismiss = React.useCallback(() => {
        previous.current.clear()
        setItems([])
        updateBatch(() => ({ ids: [], from: null }))
    }, [updateBatch])

    const retry = React.useCallback(
        async (id: number) => {
            const result = await retryReceiptAnalysisAction(id)
            if (!result.success) {
                toast.error(result.error)
                return
            }
            previous.current.set(id, "ANALYZING")
            toast.info("読み取り直しています")
            await refresh()
            router.refresh()
        },
        [refresh, router]
    )

    const goNext = React.useCallback(
        async (afterId: number | null) => {
            // 読み直している間に「全件済み」の片付けが走ると戻り先が消えるので、始めた時点のまとまりを使う
            const { ids, from } = batchRef.current
            const result = await getReceiptBatchAction(ids).catch(() => null)
            const latest = result?.success ? result.data : []
            const next = nextBatchReceiptId(latest, afterId)
            if (next !== null) {
                router.push(buildReceiptDetailPath(next, null))
                return
            }
            updateBatch(() => ({ ids: [], from: null }))
            toast.success("取り込んだレシートをすべて確認しました")
            router.push(from ? resolveReturnPath(from) : RECEIPT_LIST_PATH)
        },
        [router, updateBatch]
    )

    const value = React.useMemo<ReceiptImportContextValue>(
        () => ({ openCamera, items, ids: batch.ids, summary, refresh, dismiss, retry, goNext }),
        // summary は items・uploading から決まる
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [openCamera, items, batch.ids, uploading, refresh, dismiss, retry, goNext]
    )

    const onDetail = pathname.startsWith(RECEIPT_LIST_PATH + "/")
    return (
        <ReceiptImportContext.Provider value={value}>
            {children}
            <ReceiptCamera
                open={cameraOpen}
                onOpenChange={setCameraOpen}
                sentCount={sentInCamera}
                analyzingCount={summary.analyzing}
                onSubmit={enqueue}
            />
            {/* 確認画面は上部に並びを出すので、トレイは出さない */}
            {!cameraOpen && !onDetail && batch.ids.length + uploading > 0 && (
                <ReceiptImportTray summary={summary} onReview={() => void goNext(null)} onDismiss={dismiss} />
            )}
        </ReceiptImportContext.Provider>
    )
}

export function useReceiptImport(): ReceiptImportContextValue | null {
    return React.useContext(ReceiptImportContext)
}

/**
 * レシート撮影の入口（Issue #975・#1087）。カメラ画面は `ReceiptImportProvider` が1つだけ持つ。
 * `onBeforeOpen` は開く前に呼ぶ（呼び出し元のシート・ダイアログを閉じる）。
 */
export function useReceiptCapture(onBeforeOpen?: () => void) {
    const context = useReceiptImport()
    const open = React.useCallback(() => {
        onBeforeOpen?.()
        context?.openCamera()
    }, [context, onBeforeOpen])
    return { open, available: context !== null }
}
