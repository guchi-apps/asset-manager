import { prisma } from "../lib/prisma"

/**
 * 「置き換え済み（REPLACED）」へ誤って進めたレシートを「確認待ち（REVIEW_REQUIRED）」へ戻す（Issue #309）。
 *
 * 一括処理ではなく、id を明示指定したレコードだけを戻す。**推測で範囲指定して書き換えない。**
 * 対象を間違えると、実際にZaimへ登録済みの支出記録の状態表示が崩れる。
 *
 *   # 対象候補を確認する（購入日の範囲でREPLACEDのレコードを一覧表示）
 *   npx -y tsx --env-file-if-exists=.env scripts/revert-replaced-receipts.ts \
 *     --list --from 2026-08-01 --to 2026-08-31
 *
 *   # 下見（--apply を付けるまで書き換えない）
 *   npx -y tsx --env-file-if-exists=.env scripts/revert-replaced-receipts.ts --id 123 --id 456
 *
 *   # 反映する
 *   npx -y tsx --env-file-if-exists=.env scripts/revert-replaced-receipts.ts --id 123 --id 456 --apply
 */

function stringArg(name: string): string | undefined {
    const index = process.argv.indexOf(`--${name}`)
    return index < 0 ? undefined : process.argv[index + 1]
}

/** `--id` は複数回指定できる。 */
function idArgs(): number[] {
    const ids: number[] = []
    for (const [index, value] of process.argv.entries()) {
        if (value !== "--id") continue
        const raw = process.argv[index + 1]
        const parsed = Number(raw)
        if (!Number.isInteger(parsed) || parsed <= 0) {
            throw new Error(`--id には正の整数を指定してください（受け取った値: ${String(raw)}）`)
        }
        ids.push(parsed)
    }
    return ids
}

function describe(receipt: {
    id: number
    source: string
    storeName: string | null
    purchasedAt: Date | null
    totalAmount: number | null
    replacedAt: Date | null
}): string {
    const purchasedAt = receipt.purchasedAt?.toLocaleDateString("en-CA", {
        timeZone: "Asia/Tokyo",
    })
    return (
        `id=${receipt.id} 由来=${receipt.source} 店舗=${JSON.stringify(receipt.storeName)} ` +
        `購入日=${purchasedAt ?? "（未入力）"} 金額=${receipt.totalAmount ?? "（未入力）"}円 ` +
        `置き換え日時=${receipt.replacedAt?.toISOString() ?? "（なし）"}`
    )
}

async function list(): Promise<void> {
    const from = stringArg("from")
    const to = stringArg("to")
    if (!from || !to) {
        throw new Error("--list には --from <YYYY-MM-DD> --to <YYYY-MM-DD> を指定してください。")
    }

    const receipts = await prisma.receiptImport.findMany({
        where: {
            status: "REPLACED",
            purchasedAt: {
                gte: new Date(`${from}T00:00:00+09:00`),
                lte: new Date(`${to}T23:59:59+09:00`),
            },
        },
        orderBy: { purchasedAt: "asc" },
        select: {
            id: true,
            source: true,
            storeName: true,
            purchasedAt: true,
            totalAmount: true,
            replacedAt: true,
        },
    })

    if (receipts.length === 0) {
        console.log("対象期間に置き換え済みのレシートはありません。")
        return
    }
    console.log(`置き換え済みのレシート ${receipts.length} 件:`)
    for (const receipt of receipts) console.log("  " + describe(receipt))
    console.log("")
    console.log("戻す対象を --id で指定してください（複数可）。")
}

async function revert(ids: number[]): Promise<void> {
    const targets = await prisma.receiptImport.findMany({
        where: { id: { in: ids }, status: "REPLACED" },
        select: {
            id: true,
            source: true,
            storeName: true,
            purchasedAt: true,
            totalAmount: true,
            replacedAt: true,
        },
    })

    const foundIds = new Set(targets.map((receipt) => receipt.id))
    const missing = ids.filter((id) => !foundIds.has(id))
    if (missing.length > 0) {
        throw new Error(
            `置き換え済み（REPLACED）のレシートではありません: ${missing.join(", ")}` +
                "（idの誤りか、すでに別の状態です。--list で確認してください）"
        )
    }

    const apply = process.argv.includes("--apply")
    console.log(`${apply ? "確認待ちへ戻します" : "確認待ちへ戻す予定（--apply なしのため実行しません）"}:`)
    for (const receipt of targets) console.log("  " + describe(receipt))

    if (!apply) {
        console.log("")
        console.log("実行するには --apply を付けてください。")
        return
    }

    const updated = await prisma.receiptImport.updateMany({
        where: { id: { in: ids }, status: "REPLACED" },
        data: { status: "REVIEW_REQUIRED", replacedAt: null },
    })
    console.log(`${updated.count} 件を確認待ちへ戻しました。`)
}

async function main(): Promise<void> {
    if (process.argv.includes("--list")) {
        await list()
        return
    }

    const ids = idArgs()
    if (ids.length === 0) {
        console.error("--list --from <日付> --to <日付>、または --id <id> で対象を指定してください。")
        process.exitCode = 1
        return
    }
    await revert(ids)
}

main()
    .catch((error) => {
        console.error(error instanceof Error ? error.message : String(error))
        process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
