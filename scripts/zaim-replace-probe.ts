import {
    createZaimPayment,
    deleteZaimPayment,
    fetchZaimAccounts,
    fetchZaimMoney,
    getZaimApiCredentials,
    getZaimPendingAccountId,
    updateZaimPaymentGenre,
    type ZaimApiCredentials,
    type ZaimMoneyResponseItem,
} from "../lib/zaim-api"
import {
    buildProbeCases,
    collectProbeEntries,
    pickEditProbeTarget,
    pickProbeTarget,
    type ProbeMoneyEntry,
} from "../lib/zaim-replace-probe"

/**
 * Zaim「レシート置き換え」の成立条件を実測するコマンド（Issue #300）。
 *
 * 置き換えの最後の1手はスマートフォンアプリ限定なので、**このコマンドだけでは結論は出ない**。
 * 条件違いの明細を用意するところまでを機械で行い、候補に出たかどうかは実機で見てもらう。
 * 判定の根拠と条件の一覧は `lib/zaim-replace-probe.ts` と `docs/receipt-import.md` にある。
 *
 *   npx -y tsx --env-file-if-exists=.env scripts/zaim-replace-probe.ts --card <id>
 *   npx -y tsx --env-file-if-exists=.env scripts/zaim-replace-probe.ts --card <id> --create
 *   npx -y tsx --env-file-if-exists=.env scripts/zaim-replace-probe.ts --card <id> --check-edit
 *   npx -y tsx --env-file-if-exists=.env scripts/zaim-replace-probe.ts --list
 *   npx -y tsx --env-file-if-exists=.env scripts/zaim-replace-probe.ts --cleanup
 *
 * 既定（`--create` などを付けない）は下見で、Zaimへ一切書き込まない。
 */

/** 的にするカード明細を探す範囲。締めの都合で明細が届くまで日数がかかるため広めに取る。 */
const LOOKBACK_DAYS = 60

/** 一度に取る明細数の上限。1日あたり数件の家計簿なので60日分はこれで足りる。 */
const FETCH_LIMIT = 1000

function formatDate(date: Date): string {
    // Zaimの日付はJSTなので、UTCのISO文字列をそのまま切ると日付がずれる。
    return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(date)
}

function toProbeEntry(item: ZaimMoneyResponseItem): ProbeMoneyEntry {
    return {
        id: item.id,
        date: item.date,
        amount: item.amount,
        fromAccountId: item.from_account_id,
        categoryId: item.category_id,
        genreId: item.genre_id,
        name: item.name ?? "",
        place: item.place ?? "",
        comment: item.comment ?? "",
        active: item.active,
    }
}

interface Context {
    credentials: ZaimApiCredentials
    entries: ProbeMoneyEntry[]
    accountName: (id: number) => string
}

async function loadContext(): Promise<Context> {
    const credentials = getZaimApiCredentials()
    if (!credentials) {
        throw new Error(
            "Zaim APIの資格情報が設定されていません。ZAIM_CONSUMER_KEY / ZAIM_CONSUMER_SECRET / " +
                "ZAIM_ACCESS_TOKEN / ZAIM_ACCESS_TOKEN_SECRET を設定してください。"
        )
    }

    const now = new Date()
    const from = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
    const [accounts, money] = await Promise.all([
        fetchZaimAccounts(credentials),
        fetchZaimMoney(credentials, {
            startDate: formatDate(from),
            endDate: formatDate(now),
            mode: "payment",
            limit: FETCH_LIMIT,
        }),
    ])

    const names = new Map(accounts.map((account) => [account.id, account.name]))
    return {
        credentials,
        entries: money.map(toProbeEntry),
        accountName: (id) => names.get(id) ?? `口座${id}`,
    }
}

function describe(context: Context, entry: ProbeMoneyEntry): string {
    return (
        `id=${entry.id} ${entry.date} ${entry.amount.toLocaleString()}円 ` +
        `口座=${context.accountName(entry.fromAccountId)} ` +
        `品目=${JSON.stringify(entry.name)} 店=${JSON.stringify(entry.place)}`
    )
}

/**
 * `--card` の指定を解決する。
 *
 * **推測で決めない。** 出金元を間違えると、関係のないカードの家計簿へテスト明細が入る。
 * 未指定のときは直近の明細から候補を挙げるだけにして、指定し直してもらう。
 */
function resolveCardAccountId(context: Context): number {
    const raw = process.argv[process.argv.indexOf("--card") + 1]
    const parsed = Number(raw)
    if (process.argv.includes("--card") && Number.isInteger(parsed) && parsed > 0) return parsed

    const counts = new Map<number, number>()
    for (const entry of context.entries) {
        counts.set(entry.fromAccountId, (counts.get(entry.fromAccountId) ?? 0) + 1)
    }
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)

    console.error("--card <口座id> で、自動連携しているクレジットカードの口座を指定してください。")
    console.error(`直近${LOOKBACK_DAYS}日の支出が多い口座:`)
    for (const [id, count] of ranked) {
        console.error(`  ${String(id).padStart(10)}  ${context.accountName(id)}（${count}件）`)
    }
    console.error("口座の全一覧は npx -y tsx scripts/zaim-oauth.ts --accounts で出せます。")
    throw new Error("カード口座が指定されていません")
}

function requirePendingAccountId(): number {
    const pendingAccountId = getZaimPendingAccountId()
    if (!pendingAccountId) {
        throw new Error("ZAIM_PENDING_ACCOUNT_ID が設定されていません（ケースAの出金元に使います）。")
    }
    return pendingAccountId
}

/** 下見。何が的になり、何が登録されるかを見せるだけで、Zaimへは書き込まない。 */
function showPlan(context: Context, cardAccountId: number): void {
    const pendingAccountId = requirePendingAccountId()

    const existing = collectProbeEntries(context.entries)
    if (existing.length > 0) {
        console.log(`前回の検証明細が ${existing.length} 件残っています（--cleanup で消せます）:`)
        for (const entry of existing) console.log("  " + describe(context, entry))
        console.log("")
    }

    const target = pickProbeTarget(context.entries, cardAccountId)
    if (!target) {
        // 条件に合う的が無いまま登録すると、候補に出なかった理由が条件なのか的なのか
        // 分からなくなる。黙って緩めず、ここで止める。
        throw new Error(
            `${context.accountName(cardAccountId)} に、検証の的にできる明細が直近${LOOKBACK_DAYS}日で` +
                "見つかりませんでした（品目・コメントが空で、同じ日付・金額の明細が他に無いもの）。" +
                "カード明細が届くのを待つか、--card の指定を見直してください。"
        )
    }

    console.log("的にする連携カード明細:")
    console.log("  " + describe(context, target))
    console.log("")
    console.log("登録する検証明細:")
    for (const probe of buildProbeCases(target, { pendingAccountId, cardAccountId })) {
        console.log(`  [${probe.caseId}] ${probe.hypothesis}`)
        console.log(
            `        ${probe.date} ${probe.amount.toLocaleString()}円 ` +
                `出金元=${context.accountName(probe.fromAccountId)} 品目=${JSON.stringify(probe.name)}`
        )
    }
    console.log("")
    console.log("この内容で登録する場合は --create を付けて実行してください。")
}

async function create(context: Context, cardAccountId: number): Promise<void> {
    const pendingAccountId = requirePendingAccountId()

    const existing = collectProbeEntries(context.entries)
    if (existing.length > 0) {
        // 条件違いを見分けるための検証なので、前回分が残ったまま足すと候補が入り混じる。
        throw new Error(
            `前回の検証明細が ${existing.length} 件残っています。--cleanup で消してから実行してください。`
        )
    }

    const target = pickProbeTarget(context.entries, cardAccountId)
    if (!target) {
        throw new Error(
            `${context.accountName(cardAccountId)} に、検証の的にできる明細が見つかりませんでした。` +
                "--card の指定を見直してください（下見は引数なしで実行できます）。"
        )
    }

    console.log("的にする連携カード明細: " + describe(context, target))

    const created: number[] = []
    try {
        for (const probe of buildProbeCases(target, { pendingAccountId, cardAccountId })) {
            const { id } = await createZaimPayment(context.credentials, {
                date: probe.date,
                categoryId: probe.categoryId,
                genreId: probe.genreId,
                amount: probe.amount,
                fromAccountId: probe.fromAccountId,
                name: probe.name,
                place: probe.place,
                comment: probe.comment,
            })
            created.push(id)
            console.log(
                `  [${probe.caseId}] 登録しました id=${id} ` +
                    `出金元=${context.accountName(probe.fromAccountId)}`
            )
        }
    } catch (error) {
        // 片方だけ残ると「どちらが候補に出たのか」が比較にならない。まとめて巻き戻す。
        console.error("登録に失敗したため、登録済みの検証明細を削除します。")
        for (const id of created) {
            await deleteZaimPayment(context.credentials, id).catch((cause) => {
                console.error(`  id=${id} の削除にも失敗しました: ${String(cause)}`)
            })
        }
        throw error
    }

    console.log("")
    console.log("次は実機での確認です。")
    console.log(`  1. スマートフォンのZaimアプリで ${target.date} / ${target.amount.toLocaleString()}円 の`)
    console.log(`     「${context.accountName(cardAccountId)}」の明細を開く`)
    console.log("  2. 「置き換え」を開き、候補にA・Bのどちらが出るかを見る")
    console.log("  3. 置き換えは実行せず、候補の見え方だけを控える")
    console.log("  4. 確認できたら --cleanup で検証明細を削除する")
}

function list(context: Context): void {
    const existing = collectProbeEntries(context.entries)
    if (existing.length === 0) {
        console.log("検証明細はありません。")
        return
    }
    console.log(`検証明細 ${existing.length} 件:`)
    for (const entry of existing) console.log("  " + describe(context, entry))
}

async function cleanup(context: Context): Promise<void> {
    const existing = collectProbeEntries(context.entries)
    if (existing.length === 0) {
        console.log("削除する検証明細はありません。")
        return
    }

    let failed = 0
    for (const entry of existing) {
        try {
            await deleteZaimPayment(context.credentials, entry.id)
            console.log("  削除しました " + describe(context, entry))
        } catch (error) {
            failed += 1
            console.error(`  削除に失敗しました id=${entry.id}: ${String(error)}`)
        }
    }
    if (failed > 0) {
        throw new Error(`${failed} 件の検証明細を削除できませんでした。Zaimの画面から消してください。`)
    }
}

/**
 * ケースC。連携カード明細をAPIで更新できるかを確かめる。
 *
 * 送るのは `fetchZaimMoney` で取った値そのものなので、**成功しても明細は変わらない**。
 * これが通るなら、置き換えを経ずに「カード明細へ直接品目を書き込む」経路が採れる。
 */
async function checkEdit(context: Context, cardAccountId: number): Promise<void> {
    const target = pickEditProbeTarget(context.entries, cardAccountId)
    if (!target) {
        throw new Error(
            `${context.accountName(cardAccountId)} に、更新を試せる明細が見つかりませんでした` +
                "（カテゴリ・内訳が入っているもの）。"
        )
    }

    console.log("更新を試す連携カード明細: " + describe(context, target))
    console.log("  送るのは取得した値と同じ値なので、成功しても明細は変わりません。")

    try {
        await updateZaimPaymentGenre(context.credentials, {
            moneyId: target.id,
            date: target.date,
            amount: target.amount,
            categoryId: target.categoryId,
            genreId: target.genreId,
        })
        console.log("  → 更新できました。連携明細もAPIから編集できます（ケースC: 成立）。")
    } catch (error) {
        console.log(`  → 更新できませんでした（ケースC: 不成立）: ${String(error)}`)
    }
}

async function main(): Promise<void> {
    const context = await loadContext()

    if (process.argv.includes("--list")) {
        list(context)
        return
    }
    if (process.argv.includes("--cleanup")) {
        await cleanup(context)
        return
    }

    const cardAccountId = resolveCardAccountId(context)

    if (process.argv.includes("--check-edit")) {
        await checkEdit(context, cardAccountId)
        return
    }
    if (process.argv.includes("--create")) {
        await create(context, cardAccountId)
        return
    }
    showPlan(context, cardAccountId)
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
})
