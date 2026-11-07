/** 縮小後の長辺の上限（px）。レシートの文字が読める大きさを保ちつつ、1MB前後に収める。 */
export const RECEIPT_IMAGE_MAX_EDGE = 2000
/** この大きさ以下で、長辺も上限以内なら縮小せずそのまま送る。 */
export const RECEIPT_IMAGE_KEEP_BYTES = 1.5 * 1024 * 1024

export interface ImageSize {
    width: number
    height: number
}

/** 長辺が `maxEdge` に収まるよう縦横比を保って縮める。収まっていれば同じ大きさを返す。 */
export function fitWithin(size: ImageSize, maxEdge: number = RECEIPT_IMAGE_MAX_EDGE): ImageSize {
    const longest = Math.max(size.width, size.height)
    if (longest <= maxEdge || longest <= 0) return { width: size.width, height: size.height }
    const scale = maxEdge / longest
    return {
        width: Math.max(1, Math.round(size.width * scale)),
        height: Math.max(1, Math.round(size.height * scale)),
    }
}

/** 縮小が要るか。形式がJPEG以外（HEIC等）や大きい写真は縮める。 */
export function needsResize(file: { size: number; type: string }, size: ImageSize): boolean {
    const fitted = fitWithin(size)
    if (fitted.width !== size.width || fitted.height !== size.height) return true
    return file.size > RECEIPT_IMAGE_KEEP_BYTES
}
