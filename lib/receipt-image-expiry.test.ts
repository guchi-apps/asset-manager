import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { expireReceiptImages, receiptImageExpiryCutoff, type ReceiptImageExpiryDeps } from "@/lib/receipt-image-expiry"

describe("receiptImageExpiryCutoff", () => {
    it("30日前を返す", () => {
        const cutoff = receiptImageExpiryCutoff(new Date("2026-11-30T00:00:00.000Z"))
        assert.equal(cutoff.toISOString(), "2026-10-31T00:00:00.000Z")
    })
})

describe("expireReceiptImages", () => {
    const now = new Date("2026-11-30T00:00:00.000Z")

    it("ファイル削除が済んだ行だけDBを更新し、1件の失敗で止まらない", async () => {
        const removed: string[] = []
        const cleared: number[] = []
        const deps: ReceiptImageExpiryDeps = {
            findExpired: async () => [
                { id: 1, imagePath: "a.jpg" },
                { id: 2, imagePath: "b.jpg" },
                { id: 3, imagePath: "c.jpg" },
            ],
            removeFile: async (path) => {
                if (path === "b.jpg") throw new Error("EACCES")
                removed.push(path)
            },
            clearRecord: async (id) => {
                cleared.push(id)
            },
        }
        const originalError = console.error
        console.error = () => {}
        try {
            const result = await expireReceiptImages(deps, now)
            assert.deepEqual(result, { deleted: 2, failed: 1 })
        } finally {
            console.error = originalError
        }
        assert.deepEqual(removed, ["a.jpg", "c.jpg"])
        assert.deepEqual(cleared, [1, 3])
    })

    it("検索には30日前の日時を渡す", async () => {
        let received: Date | null = null
        await expireReceiptImages(
            {
                findExpired: async (cutoff) => {
                    received = cutoff
                    return []
                },
                removeFile: async () => {},
                clearRecord: async () => {},
            },
            now
        )
        assert.equal((received as Date | null)?.toISOString(), "2026-10-31T00:00:00.000Z")
    })
})
