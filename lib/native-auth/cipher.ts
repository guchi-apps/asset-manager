import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto"

/**
 * 引き継ぎ用の行（Issue #1106）へ置くセッションのトークンの暗号化。
 *
 * 行は60秒だけ存在し、消費時に消す。それでもDBへ平文のトークンは置かない。
 * 鍵は専用のシークレット `NATIVE_AUTH_HANDOFF_KEY` から、用途の印（`info`）付きのHKDFで導く。
 * 未設定ならログインの引き継ぎごと閉じる（平文へ落とさない）。
 */

const ALGORITHM = "aes-256-gcm"
const IV_LENGTH = 12
const INFO = "asset-manager-native-auth-handoff-v1"

function getKey(secret: string | undefined): Buffer {
    if (!secret) {
        throw new Error("NATIVE_AUTH_HANDOFF_KEY is not set")
    }
    return Buffer.from(hkdfSync("sha256", secret, "", INFO, 32))
}

export function encryptSession(plainText: string, secret = process.env.NATIVE_AUTH_HANDOFF_KEY): string {
    const iv = randomBytes(IV_LENGTH)
    const cipher = createCipheriv(ALGORITHM, getKey(secret), iv)
    const encrypted = Buffer.concat([cipher.update(plainText, "utf-8"), cipher.final()])
    return `${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${encrypted.toString("base64")}`
}

export function decryptSession(cipherText: string, secret = process.env.NATIVE_AUTH_HANDOFF_KEY): string {
    const [ivB64, authTagB64, encryptedB64] = cipherText.split(":")
    if (!ivB64 || !authTagB64 || !encryptedB64) {
        throw new Error("Invalid cipher text format")
    }
    const decipher = createDecipheriv(ALGORITHM, getKey(secret), Buffer.from(ivB64, "base64"))
    decipher.setAuthTag(Buffer.from(authTagB64, "base64"))
    return Buffer.concat([decipher.update(Buffer.from(encryptedB64, "base64")), decipher.final()]).toString("utf-8")
}
