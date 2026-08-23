import { after, before, describe, it } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
    ReceiptStorageError,
    deleteReceiptImage,
    getReceiptStorageDir,
    hashImage,
    readReceiptImage,
    resolveReceiptImagePath,
    saveReceiptImage,
} from "./receipt-storage"

let baseDir = ""
const originalDir = process.env.RECEIPT_STORAGE_DIR

before(async () => {
    baseDir = await mkdtemp(path.join(tmpdir(), "receipt-storage-test-"))
    process.env.RECEIPT_STORAGE_DIR = baseDir
})

after(async () => {
    if (originalDir === undefined) delete process.env.RECEIPT_STORAGE_DIR
    else process.env.RECEIPT_STORAGE_DIR = originalDir
    if (baseDir) await rm(baseDir, { recursive: true, force: true })
})

const png = Buffer.from("fake png bytes")

describe("getReceiptStorageDir", () => {
    it("honours RECEIPT_STORAGE_DIR", () => {
        assert.equal(getReceiptStorageDir(), baseDir)
    })
})

describe("resolveReceiptImagePath", () => {
    it("rejects a path that escapes the storage directory", () => {
        assert.throws(
            () => resolveReceiptImagePath("../../etc/passwd"),
            ReceiptStorageError
        )
        assert.throws(() => resolveReceiptImagePath("/etc/passwd"), ReceiptStorageError)
    })

    it("accepts a path inside the storage directory", () => {
        assert.equal(
            resolveReceiptImagePath("user-1/2026-08/abc.png"),
            path.join(baseDir, "user-1/2026-08/abc.png")
        )
    })
})

describe("saveReceiptImage", () => {
    it("writes the file and returns a relative path plus the hash", async () => {
        const saved = await saveReceiptImage("user-1", png, "image/png")

        assert.equal(saved.hash, hashImage(png))
        assert.equal(saved.byteSize, png.byteLength)
        assert.ok(saved.relativePath.startsWith("user-1" + path.sep))
        assert.ok(saved.relativePath.endsWith(".png"))

        const stats = await stat(path.join(baseDir, saved.relativePath))
        assert.equal(stats.size, png.byteLength)

        assert.deepEqual(await readReceiptImage(saved.relativePath), png)
    })

    it("writes the same image to the same path twice", async () => {
        const first = await saveReceiptImage("user-2", png, "image/jpeg")
        const second = await saveReceiptImage("user-2", png, "image/jpeg")
        assert.equal(first.relativePath, second.relativePath)
    })

    it("keeps each user's images apart", async () => {
        const a = await saveReceiptImage("user-a", png, "image/webp")
        const b = await saveReceiptImage("user-b", png, "image/webp")
        assert.notEqual(a.relativePath, b.relativePath)
    })

    it("rejects unsupported formats and empty files", async () => {
        await assert.rejects(
            () => saveReceiptImage("user-1", png, "application/pdf"),
            ReceiptStorageError
        )
        await assert.rejects(
            () => saveReceiptImage("user-1", Buffer.alloc(0), "image/png"),
            ReceiptStorageError
        )
    })

    it("rejects an image over the size limit", async () => {
        await assert.rejects(
            () => saveReceiptImage("user-1", Buffer.alloc(6 * 1024 * 1024), "image/png"),
            ReceiptStorageError
        )
    })
})

describe("deleteReceiptImage", () => {
    it("removes the file and stays quiet when it is already gone", async () => {
        const saved = await saveReceiptImage("user-3", Buffer.from("to delete"), "image/png")
        await deleteReceiptImage(saved.relativePath)
        await assert.rejects(() => readReceiptImage(saved.relativePath))
        await deleteReceiptImage(saved.relativePath)
    })
})
