/**
 * レシート画像の保存（Issue #153）。
 *
 * 画像はDBに入れず、サーバーのファイルシステムへ置いてDBにはパスだけを持つ。
 * バックアップの取り回しとDBサイズの都合で、`.zaim/` と同じくデプロイのクリーンアップ対象外の
 * ディレクトリを使う。
 */

import { createHash } from "node:crypto"
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { isSupportedImageMimeType, MAX_IMAGE_BYTES } from "@/lib/receipt-analysis"

const EXTENSION_BY_MIME: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
}

export function getReceiptStorageDir(): string {
    return process.env.RECEIPT_STORAGE_DIR || path.join(process.cwd(), "storage", "receipts")
}

export class ReceiptStorageError extends Error {
    constructor(message: string) {
        super(message)
        this.name = "ReceiptStorageError"
    }
}

/**
 * DBに入っている相対パスを実ファイルのパスへ変換する。
 *
 * 相対パスは配信用のAPIから渡ってくるため、`..` で保存先の外へ出られないことを必ず確かめる。
 */
export function resolveReceiptImagePath(relativePath: string): string {
    const baseDir = path.resolve(getReceiptStorageDir())
    const resolved = path.resolve(baseDir, relativePath)
    if (resolved !== baseDir && !resolved.startsWith(baseDir + path.sep)) {
        throw new ReceiptStorageError("保存先の外を指すパスは扱えません")
    }
    return resolved
}

export interface SavedReceiptImage {
    /** 保存先ディレクトリからの相対パス。DBへはこれを保存する。 */
    relativePath: string
    /** 画像のSHA-256。同じレシートを二度取り込んだことの判定に使う。 */
    hash: string
    mimeType: string
    byteSize: number
}

export function hashImage(buffer: Buffer): string {
    return createHash("sha256").update(buffer).digest("hex")
}

/**
 * 画像を保存し、DBへ入れる相対パスとハッシュを返す。
 * ファイル名はハッシュにするため、同じ画像を再度保存しても増えない。
 */
export async function saveReceiptImage(
    userId: string,
    buffer: Buffer,
    mimeType: string
): Promise<SavedReceiptImage> {
    if (!isSupportedImageMimeType(mimeType)) {
        throw new ReceiptStorageError(
            "対応していない画像形式です（JPEG・PNG・WebP・GIFのみ）"
        )
    }
    if (buffer.byteLength === 0) {
        throw new ReceiptStorageError("画像が空です")
    }
    if (buffer.byteLength > MAX_IMAGE_BYTES) {
        throw new ReceiptStorageError(
            "画像が大きすぎます（" + Math.floor(MAX_IMAGE_BYTES / 1024 / 1024) + "MBまで）"
        )
    }

    const hash = hashImage(buffer)
    const extension = EXTENSION_BY_MIME[mimeType]
    // ユーザーIDで分け、さらに年月で分ける。1ディレクトリにファイルが溜まり続けるのを避ける。
    const now = new Date()
    const yearMonth = now.toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" }).slice(0, 7)
    const relativePath = path.join(userId, yearMonth, hash + "." + extension)
    const absolutePath = resolveReceiptImagePath(relativePath)

    await mkdir(path.dirname(absolutePath), { recursive: true })
    await writeFile(absolutePath, buffer)

    return { relativePath, hash, mimeType, byteSize: buffer.byteLength }
}

export async function readReceiptImage(relativePath: string): Promise<Buffer> {
    return readFile(resolveReceiptImagePath(relativePath))
}

/** 取り込みを削除したときに呼ぶ。ファイルが無くても失敗させない。 */
export async function deleteReceiptImage(relativePath: string): Promise<void> {
    try {
        await unlink(resolveReceiptImagePath(relativePath))
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== "ENOENT") throw error
    }
}
