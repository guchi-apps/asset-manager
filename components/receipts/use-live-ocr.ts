"use client"

import * as React from "react"

import { confirmStable, extractReceiptFields, type LiveReceiptFields } from "@/lib/receipt-live-ocr"

/** 認識の間隔（前の認識が終わってからの待ち）。短くすると電池を食うので長めにする */
const INTERVAL_MS = 1800
/** OCRへ渡す画像の高さ。大きいほど精度は上がるが重くなる */
const OCR_HEIGHT = 1100
/** 位置合わせ枠（3:5）と同じ比率で中央を切り出す */
const GUIDE_ASPECT = 3 / 5
/** 何回続けて何も読めなかったら表示を消すか */
const CLEAR_AFTER_EMPTY = 3

const EMPTY: LiveReceiptFields = { total: null, date: null }

type OcrWorker = {
    recognize: (image: HTMLCanvasElement) => Promise<{ data: { text: string } }>
    terminate: () => Promise<unknown>
}

/** 映像の中央（位置合わせ枠の範囲）を縮小して canvas に描く */
function drawGuideRegion(video: HTMLVideoElement, canvas: HTMLCanvasElement): boolean {
    const vw = video.videoWidth
    const vh = video.videoHeight
    if (!vw || !vh) return false
    const cropWidth = Math.min(vw, vh * GUIDE_ASPECT)
    const sx = (vw - cropWidth) / 2
    canvas.height = OCR_HEIGHT
    canvas.width = Math.round(OCR_HEIGHT * (cropWidth / vh))
    const context = canvas.getContext("2d")
    if (!context) return false
    context.drawImage(video, sx, 0, cropWidth, vh, 0, 0, canvas.width, canvas.height)
    return true
}

/**
 * カメラ映像から合計金額・日付を端末内で読み取る参考表示（Issue #1095）。
 * - `active` が true の間だけ動く。確認画面・閉じたときは Worker ごと止める
 * - 前の認識が終わってから次を予約するので重ならない。画面が裏にあるあいだは読まない
 * - 学習データの取得などで失敗したら黙って止める（撮影・AI読み取りには影響させない）
 */
export function useLiveOcr(videoRef: React.RefObject<HTMLVideoElement | null>, active: boolean): LiveReceiptFields {
    const [fields, setFields] = React.useState<LiveReceiptFields>(EMPTY)

    React.useEffect(() => {
        if (!active) {
            setFields(EMPTY)
            return
        }
        let cancelled = false
        let timer: ReturnType<typeof setTimeout> | undefined
        let worker: OcrWorker | null = null
        let previous: LiveReceiptFields | null = null
        let emptyCount = 0
        const canvas = document.createElement("canvas")

        const tick = async () => {
            const video = videoRef.current
            if (!cancelled && worker && video && !document.hidden && drawGuideRegion(video, canvas)) {
                try {
                    const { data } = await worker.recognize(canvas)
                    if (cancelled) return
                    const current = extractReceiptFields(data.text)
                    const stable = confirmStable(previous, current)
                    previous = current
                    if (current.total === null && current.date === null) {
                        emptyCount += 1
                        if (emptyCount >= CLEAR_AFTER_EMPTY) setFields(EMPTY)
                    } else {
                        emptyCount = 0
                        // 2回続けて同じ値だった項目だけ更新する（誤読のちらつきを避ける）
                        setFields((old) => ({ total: stable.total ?? old.total, date: stable.date ?? old.date }))
                    }
                } catch {
                    return
                }
            }
            if (!cancelled) timer = setTimeout(() => void tick(), INTERVAL_MS)
        }

        void import("tesseract.js")
            .then(async ({ createWorker }) => {
                const created = (await createWorker("jpn")) as unknown as OcrWorker
                if (cancelled) {
                    void created.terminate()
                    return
                }
                worker = created
                void tick()
            })
            .catch(() => {
                // 学習データを取得できない等。表示を出さないだけで撮影は続けられる
            })

        return () => {
            cancelled = true
            if (timer) clearTimeout(timer)
            if (worker) void worker.terminate()
            setFields(EMPTY)
        }
    }, [active, videoRef])

    return fields
}
