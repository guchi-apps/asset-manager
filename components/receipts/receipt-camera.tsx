"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { Camera, Flashlight, FlashlightOff, ImageIcon, Loader2, RotateCcw, ScanText, X } from "lucide-react"

import { cn } from "@/lib/utils"

type TorchCapabilities = MediaTrackCapabilities & { torch?: boolean }

/** 背面カメラの映像を要求する条件。解像度は「なるべく高く」で、足りない端末でも失敗させない */
const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
    facingMode: { ideal: "environment" },
    width: { ideal: 3840 },
    height: { ideal: 2160 },
}

/** getUserMedia の失敗を、利用者が次に何をすればよいかが分かる文に直す */
function describeCameraError(error: unknown): string {
    const name = error instanceof DOMException || error instanceof Error ? error.name : ""
    if (name === "NotAllowedError" || name === "SecurityError") return "カメラの使用が許可されていません。端末の設定で許可するか、下の方法で取り込んでください。"
    if (name === "NotFoundError" || name === "OverconstrainedError") return "使えるカメラが見つかりませんでした。下の方法で取り込んでください。"
    if (name === "NotReadableError" || name === "AbortError") return "カメラをほかのアプリが使っている可能性があります。閉じてからもう一度お試しいただくか、下の方法で取り込んでください。"
    return "カメラを起動できませんでした。下の方法で取り込んでください。"
}

/** 映像の今のコマをJPEGのFileにする */
async function grabFrame(video: HTMLVideoElement): Promise<File | null> {
    const width = video.videoWidth
    const height = video.videoHeight
    if (!width || !height) return null
    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext("2d")
    if (!context) return null
    context.drawImage(video, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92))
    if (!blob) return null
    return new File([blob], `receipt-${Date.now()}.jpg`, { type: "image/jpeg" })
}

interface ReceiptCameraProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    /** 読み取り中（閉じる・撮り直すを止める） */
    busy: boolean
    /** 撮った・選んだ写真を取り込む。失敗したときはカメラ画面に留まり、撮り直せるようにする */
    onSubmit: (file: File) => void
}

/**
 * レシート撮影のカメラ画面（Issue #1087）。押したらすぐ背面カメラを映し、画面の中で
 * 「写真から選ぶ」もできるようにする（iOSの「写真を撮る／写真から選ぶ」の選択シートを挟まない）。
 * カメラが使えない環境（未許可・カメラ無し・非HTTPS）では、ファイル選択と標準カメラに切り替える。
 */
export function ReceiptCamera({ open, onOpenChange, busy, onSubmit }: ReceiptCameraProps) {
    const videoRef = React.useRef<HTMLVideoElement>(null)
    const streamRef = React.useRef<MediaStream | null>(null)
    const galleryRef = React.useRef<HTMLInputElement>(null)
    const nativeCameraRef = React.useRef<HTMLInputElement>(null)

    const [ready, setReady] = React.useState(false)
    const [failure, setFailure] = React.useState<string | null>(null)
    const [preview, setPreview] = React.useState<File | null>(null)
    const [previewUrl, setPreviewUrl] = React.useState<string | null>(null)
    const [torch, setTorch] = React.useState<{ supported: boolean; on: boolean }>({ supported: false, on: false })

    const wantCamera = open && !preview && !failure

    // カメラの起動と停止。確認画面・代替表示・閉じたときは必ず止める（インジケーターを点けっぱなしにしない）
    React.useEffect(() => {
        if (!wantCamera) return
        let cancelled = false
        const video = videoRef.current
        setReady(false)
        if (!navigator.mediaDevices?.getUserMedia) {
            setFailure("この接続ではカメラを使えません。下の方法で取り込んでください。")
            return
        }
        navigator.mediaDevices
            .getUserMedia({ video: VIDEO_CONSTRAINTS, audio: false })
            .then(async (stream) => {
                if (cancelled) {
                    stream.getTracks().forEach((track) => track.stop())
                    return
                }
                streamRef.current = stream
                const track = stream.getVideoTracks()[0]
                const capabilities = (track?.getCapabilities?.() ?? {}) as TorchCapabilities
                setTorch({ supported: capabilities.torch === true, on: false })
                if (!video) return
                video.srcObject = stream
                try {
                    await video.play()
                } catch {
                    // 自動再生の制限に掛かっても、muted + playsInline なので映像は出る
                }
                if (!cancelled) setReady(true)
            })
            .catch((error: unknown) => {
                if (!cancelled) setFailure(describeCameraError(error))
            })
        return () => {
            cancelled = true
            streamRef.current?.getTracks().forEach((track) => track.stop())
            streamRef.current = null
            if (video) video.srcObject = null
            setReady(false)
        }
    }, [wantCamera])

    // 確認画面の写真のURL
    React.useEffect(() => {
        if (!preview) {
            setPreviewUrl(null)
            return
        }
        const url = URL.createObjectURL(preview)
        setPreviewUrl(url)
        return () => URL.revokeObjectURL(url)
    }, [preview])

    // 閉じたら次に開いたときのために状態を戻す
    React.useEffect(() => {
        if (open) return
        setPreview(null)
        setFailure(null)
    }, [open])

    const requestClose = (next: boolean) => {
        if (!next && busy) return
        onOpenChange(next)
    }

    const shoot = async () => {
        const video = videoRef.current
        if (!video || !ready) return
        const file = await grabFrame(video)
        if (file) setPreview(file)
    }

    const toggleTorch = async () => {
        const track = streamRef.current?.getVideoTracks()[0]
        if (!track) return
        const next = !torch.on
        try {
            await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] })
            setTorch({ supported: true, on: next })
        } catch {
            setTorch({ supported: false, on: false })
        }
    }

    const onPicked = (event: React.ChangeEvent<HTMLInputElement>) => {
        const picked = event.target.files?.[0]
        event.target.value = ""
        if (!picked) return
        // 選んだ写真は選び直しの手間を増やさないよう、確認を挟まずそのまま読み取る
        setPreview(picked)
        onSubmit(picked)
    }

    const title = busy ? "読み取り中" : preview ? "この写真で読み取りますか" : "レシートを撮影"

    const iconButton =
        "flex size-10 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur transition-colors hover:bg-white/25 disabled:opacity-40"
    const wideButton = "flex h-12 flex-1 items-center justify-center gap-2 rounded-xl px-4 text-[15px] font-semibold disabled:opacity-40"

    return (
        <DialogPrimitive.Root open={open} onOpenChange={requestClose}>
            <DialogPrimitive.Portal>
                <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/70" />
                <DialogPrimitive.Content
                    onEscapeKeyDown={(event) => busy && event.preventDefault()}
                    onPointerDownOutside={(event) => busy && event.preventDefault()}
                    className={cn(
                        "fixed inset-0 z-50 flex flex-col overflow-hidden bg-black text-white outline-none",
                        // iPad・スマホの横向きは操作を右側に縦に並べる
                        "landscape:pointer-coarse:flex-row",
                        // PC（マウス操作の広い画面）は中央のダイアログにする
                        "md:pointer-fine:inset-auto md:pointer-fine:top-1/2 md:pointer-fine:left-1/2 md:pointer-fine:h-[min(720px,90vh)] md:pointer-fine:w-[min(760px,92vw)] md:pointer-fine:-translate-x-1/2 md:pointer-fine:-translate-y-1/2 md:pointer-fine:rounded-2xl"
                    )}
                >
                    <DialogPrimitive.Description className="sr-only">
                        レシート全体を枠に収めて撮影します。写真ボタンから撮影済みの写真も選べます。
                    </DialogPrimitive.Description>
                    <input ref={galleryRef} type="file" accept="image/*" className="hidden" onChange={onPicked} aria-label="写真から選ぶ" />
                    <input
                        ref={nativeCameraRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        onChange={onPicked}
                        aria-label="標準カメラで撮る"
                    />

                    <div className="relative min-h-0 flex-1 overflow-hidden bg-neutral-950">
                        {/* 映像は確認画面・代替表示の間も要素を残す（ref を保つ） */}
                        <video
                            ref={videoRef}
                            muted
                            playsInline
                            autoPlay
                            aria-label="カメラの映像"
                            className={cn("absolute inset-0 size-full object-cover", (!wantCamera || !ready) && "invisible")}
                        />

                        {wantCamera && !ready && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-white/70">
                                <Loader2 className="size-7 animate-spin" aria-hidden />
                                カメラを起動しています…
                            </div>
                        )}

                        {wantCamera && ready && (
                            <>
                                {/* レシートを合わせる枠。枠の外を暗くする */}
                                <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 pt-20 pb-6">
                                    <div className="relative aspect-[3/5] max-h-full w-auto max-w-full rounded-2xl shadow-[0_0_0_9999px_rgba(0,0,0,0.45)] [height:100%]">
                                        <span className="absolute -top-0.5 -left-0.5 size-7 rounded-tl-2xl border-t-4 border-l-4 border-white" />
                                        <span className="absolute -top-0.5 -right-0.5 size-7 rounded-tr-2xl border-t-4 border-r-4 border-white" />
                                        <span className="absolute -bottom-0.5 -left-0.5 size-7 rounded-bl-2xl border-b-4 border-l-4 border-white" />
                                        <span className="absolute -right-0.5 -bottom-0.5 size-7 rounded-br-2xl border-r-4 border-b-4 border-white" />
                                    </div>
                                </div>
                                <p className="pointer-events-none absolute top-[calc(4.25rem+env(safe-area-inset-top,0px))] left-1/2 -translate-x-1/2 rounded-full bg-black/55 px-3 py-1 text-[13px] whitespace-nowrap">
                                    レシート全体を枠に収めてください
                                </p>
                            </>
                        )}

                        {previewUrl && (
                            // eslint-disable-next-line @next/next/no-img-element -- 端末内のBlob URLを表示するだけ
                            <img src={previewUrl} alt="撮影したレシート" className="absolute inset-0 size-full object-contain pt-16" />
                        )}

                        {busy && (
                            <div role="status" className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/55 text-sm">
                                <Loader2 className="size-8 animate-spin" aria-hidden />
                                読み取っています…
                                <span className="text-xs text-white/70">20〜40秒ほどかかります</span>
                            </div>
                        )}

                        {failure && !preview && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 overflow-y-auto px-6 pt-16 pb-6 text-center text-sm text-neutral-300">
                                <Camera className="size-10 text-white/70" aria-hidden />
                                <div className="max-w-xs">
                                    <p className="font-semibold text-white">カメラを起動できませんでした</p>
                                    <p className="mt-1">{failure}</p>
                                </div>
                                <button type="button" className={cn(wideButton, "w-60 flex-none bg-white text-neutral-900")} onClick={() => galleryRef.current?.click()}>
                                    <ImageIcon className="size-5" aria-hidden />
                                    写真から選ぶ
                                </button>
                                <button type="button" className={cn(wideButton, "w-60 flex-none bg-white/15")} onClick={() => nativeCameraRef.current?.click()}>
                                    <Camera className="size-5" aria-hidden />
                                    標準カメラで撮る
                                </button>
                            </div>
                        )}

                        {/* 上部の帯（閉じる・題名・ライト） */}
                        <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-2 bg-gradient-to-b from-black/60 to-transparent px-3.5 pt-[calc(0.75rem+env(safe-area-inset-top,0px))] pb-6">
                            <DialogPrimitive.Close asChild>
                                <button type="button" className={iconButton} disabled={busy} aria-label="閉じる">
                                    <X className="size-5" />
                                </button>
                            </DialogPrimitive.Close>
                            <DialogPrimitive.Title className="truncate text-[15px] font-semibold">{title}</DialogPrimitive.Title>
                            {wantCamera && ready && torch.supported ? (
                                <button
                                    type="button"
                                    className={cn(iconButton, torch.on && "bg-white text-neutral-900 hover:bg-white")}
                                    onClick={() => void toggleTorch()}
                                    aria-label={torch.on ? "ライトを消す" : "ライトを点ける"}
                                    aria-pressed={torch.on}
                                >
                                    {torch.on ? <Flashlight className="size-5" /> : <FlashlightOff className="size-5" />}
                                </button>
                            ) : (
                                <span className="size-10" aria-hidden />
                            )}
                        </div>
                    </div>

                    {/* 操作（縦向きは下、横向きのタッチ端末は右） */}
                    {!failure || preview ? (
                        <div
                            className={cn(
                                "flex shrink-0 items-center px-6 pt-4 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))]",
                                "landscape:pointer-coarse:w-32 landscape:pointer-coarse:flex-col landscape:pointer-coarse:justify-center landscape:pointer-coarse:px-3 landscape:pointer-coarse:pt-[env(safe-area-inset-top,0px)] landscape:pointer-coarse:pr-[calc(0.75rem+env(safe-area-inset-right,0px))] landscape:pointer-coarse:pb-[env(safe-area-inset-bottom,0px)]",
                                preview ? "gap-3" : "justify-around landscape:pointer-coarse:flex-col-reverse landscape:pointer-coarse:gap-10"
                            )}
                        >
                            {preview ? (
                                <>
                                    <button
                                        type="button"
                                        className={cn(wideButton, "bg-white/15 landscape:pointer-coarse:w-full landscape:pointer-coarse:flex-none")}
                                        disabled={busy}
                                        onClick={() => setPreview(null)}
                                    >
                                        <RotateCcw className="size-5" aria-hidden />
                                        撮り直す
                                    </button>
                                    <button
                                        type="button"
                                        className={cn(wideButton, "bg-white text-neutral-900 landscape:pointer-coarse:w-full landscape:pointer-coarse:flex-none")}
                                        disabled={busy}
                                        onClick={() => onSubmit(preview)}
                                    >
                                        {busy ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <ScanText className="size-5" aria-hidden />}
                                        この写真で読み取る
                                    </button>
                                </>
                            ) : (
                                <>
                                    <button
                                        type="button"
                                        className="flex w-14 flex-col items-center gap-1 text-[11px]"
                                        onClick={() => galleryRef.current?.click()}
                                        aria-label="写真から選ぶ"
                                    >
                                        <span className="flex size-12 items-center justify-center rounded-xl border-2 border-white bg-white/15">
                                            <ImageIcon className="size-5" aria-hidden />
                                        </span>
                                        写真
                                    </button>
                                    <button
                                        type="button"
                                        className="flex size-[74px] items-center justify-center rounded-full border-4 border-white disabled:opacity-40"
                                        disabled={!ready}
                                        onClick={() => void shoot()}
                                        aria-label="撮影する"
                                    >
                                        <span className="size-[58px] rounded-full bg-white transition-transform active:scale-90" />
                                    </button>
                                    <span className="w-14 landscape:pointer-coarse:hidden" aria-hidden />
                                </>
                            )}
                        </div>
                    ) : null}
                </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
    )
}
