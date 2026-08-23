import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import { isZaimAllowedEmail } from "@/lib/zaim-access"
import { readReceiptImage } from "@/lib/receipt-storage"

/**
 * レシート画像の配信（Issue #153）。
 *
 * 画像はWeb公開ディレクトリではなく `storage/receipts/` に置いてあるため、
 * ここを通してのみ読める。所有者以外には存在も知らせず404を返す。
 */
export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = await getCurrentUser()
    if (!user || !isZaimAllowedEmail(user.email)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id } = await params
    const receiptId = Number(id)
    if (!Number.isInteger(receiptId)) {
        return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const receipt = await prisma.receiptImport.findFirst({
        where: { id: receiptId, userId: user.id },
        select: { imagePath: true, imageMimeType: true },
    })
    if (!receipt?.imagePath) {
        return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    try {
        const buffer = await readReceiptImage(receipt.imagePath)
        return new NextResponse(new Uint8Array(buffer), {
            headers: {
                "Content-Type": receipt.imageMimeType ?? "application/octet-stream",
                // 内容はファイル名（ハッシュ）で一意に決まるため、長めにキャッシュしてよい。
                "Cache-Control": "private, max-age=86400",
            },
        })
    } catch (error) {
        console.error("Failed to read receipt image:", error)
        return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
}
