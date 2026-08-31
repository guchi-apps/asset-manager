import {
    createZaimPayment,
    deleteZaimPayment,
    fetchZaimAccounts,
    fetchZaimMoney,
    getZaimApiCredentials,
    getZaimPendingAccountId,
    type ZaimApiCredentials,
    type ZaimMoneyResponseItem,
} from "../lib/zaim-api"
import {
    buildProbeCases,
    collectProbeEntries,
    findConflictingEntries,
    parseProbeTarget,
    resolveDefaultGenre,
    type ProbeGenre,
    type ProbeMoneyEntry,
    type ProbeTarget,
} from "../lib/zaim-replace-probe"

/**
 * Zaim「レシート置き換え」の成立条件を実測するコマンド（Issue #300）。
 *
 * **このコマンドだけでは結論は出ない。** 置き換えの操作はスマートフォンアプリ限定で、
 * 置き換える相手のカード連携明細も公開APIから見えない（`lib/zaim-replace-probe.ts`）。
 * できるのは「候補として出るはずの明細を条件違いで用意する」ところまでで、
 * **的の指定と結果の確認は人が画面を見て行う**。
 *
 *   # 下見。Zaimへ書き込まない
 *   npx -y tsx --env-file-if-exists=.env scripts/zaim-replace-probe.ts \
 *     --card <カード口座id> --date 2026-08-27 --amount 550 --place "東テスティバル"
 *   # 登録する（同じ引数に --create を足す）
 *   # 後片付け
 *   npx -y tsx --env-file-if-exists=.env scripts/zaim-replace-probe.ts --list
 *   npx -y tsx --env-file-if-exists=.env scripts/zaim-replace-probe.ts --cleanup
 *
 * `--date` / `--amount` には、**アプリで見えている置き換え前のカード明細の値**を渡す。
 * カテゴリ・内訳は置き換えの条件に関係しないため、家計簿で最も使われている組を借りる
 * （`--category` / `--genre` で上書きできる）。
 */

/** 検証明細と衝突・既定値の判断に使う明細を取る範囲。 */
const LOOKBACK_DAYS = 90

/** 一度に取る明細数の上限。1日あたり数件の家計簿なので90日分はこれで足りる。 */
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

/** `--<name> <値>` の文字列引数。指定が無ければ undefined。 */
function stringArg(name: string): string | undefined {
    const index = process.argv.indexOf(`--${name}`)
    return index < 0 ? undefined : process.argv[index + 1]
}

function numberArg(name: string): number | null {
    const raw = stringArg(name)
    if (raw === undefined) return null
    const parsed = Number(raw)
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`--${name} には正の整数を指定してください。`)
    }
    return parsed
}

/**
 * `--card` の指定を解決する。
 *
 * **推測で決めない。** 出金元を間違えると、関係のないカードの家計簿へテスト明細が入る。
 * 未指定のときは支出の多い口座を挙げるだけにして、指定し直してもらう。
 */
function resolveCardAccountId(context: Context): number {
    const explicit = numberArg("card")
    if (explicit !== null) return explicit

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

function resolveGenre(context: Context): ProbeGenre {
    const categoryId = numberArg("category")
    const genreId = numberArg("genre")
    if (categoryId !== null && genreId !== null) return { categoryId, genreId }
    if (categoryId !== null || genreId !== null) {
        throw new Error("--category と --genre は両方まとめて指定してください。")
    }

    const fallback = resolveDefaultGenre(context.entries)
    if (!fallback) {
        throw new Error(
            "カテゴリ・内訳の既定値を決められませんでした。--category <id> --genre <id> で指定してください。"
        )
    }
    return fallback
}

interface Preparation {
    target: ProbeTarget
    genre: ProbeGenre
    cardAccountId: number
    pendingAccountId: number
}

/**
 * 登録内容を決めて、そのまま登録してよい状態かを確かめる。
 *
 * 見送るべき状況では**黙って進めずエラーで止める**。緩めると「候補に出なかった」の原因が
 * 条件なのか段取りなのか分からなくなる（#300 の検証は2度これで空振りした）。
 */
function prepare(context: Context): Preparation {
    const cardAccountId = resolveCardAccountId(context)
    const pendingAccountId = requirePendingAccountId()
    const target = parseProbeTarget({
        date: stringArg("date"),
        amount: stringArg("amount"),
        place: stringArg("place"),
    })

    const conflicting = findConflictingEntries(context.entries, target)
    if (conflicting.length > 0) {
        // APIから見えるのは手入力済み・置き換え済みの明細だけ。的と同じ日付・金額の明細が
        // すでにあるなら、その明細は置き換えを終えているか、そもそも連携明細ではない。
        console.error(`${target.date} / ${target.amount.toLocaleString()}円 の明細がすでにあります:`)
        for (const entry of conflicting) console.error("  " + describe(context, entry))
        throw new Error(
            "この日付・金額はすでにZaim APIから見えています。置き換え前のカード明細は公開APIに" +
                "現れないため、これは手入力済みか置き換え済みの明細です。別の明細を的にしてください。"
        )
    }

    return { target, genre: resolveGenre(context), cardAccountId, pendingAccountId }
}

function showCases(context: Context, preparation: Preparation): void {
    const { target, genre, cardAccountId, pendingAccountId } = preparation
    console.log(
        `的にするカード明細（アプリで見えている値）: ${target.date} ` +
            `${target.amount.toLocaleString()}円 ${target.place || "(店舗名なし)"}`
    )
    console.log(`カテゴリ/内訳: ${genre.categoryId} / ${genre.genreId}`)
    console.log("")
    console.log("登録する検証明細:")
    for (const probe of buildProbeCases(target, { pendingAccountId, cardAccountId }, genre)) {
        console.log(`  [${probe.caseId}] ${probe.hypothesis}`)
        console.log(
            `        ${probe.date} ${probe.amount.toLocaleString()}円 ` +
                `出金元=${context.accountName(probe.fromAccountId)} 品目=${JSON.stringify(probe.name)}`
        )
    }
}

/** 下見。何が登録されるかを見せるだけで、Zaimへは書き込まない。 */
function showPlan(context: Context): void {
    const existing = collectProbeEntries(context.entries)
    if (existing.length > 0) {
        console.log(`前回の検証明細が ${existing.length} 件残っています（--cleanup で消せます）:`)
        for (const entry of existing) console.log("  " + describe(context, entry))
        console.log("")
    }

    showCases(context, prepare(context))
    console.log("")
    console.log("この内容で登録する場合は --create を付けて実行してください。")
}

async function create(context: Context): Promise<void> {
    const existing = collectProbeEntries(context.entries)
    if (existing.length > 0) {
        // 条件違いを見分けるための検証なので、前回分が残ったまま足すと候補が入り混じる。
        throw new Error(
            `前回の検証明細が ${existing.length} 件残っています。--cleanup で消してから実行してください。`
        )
    }

    const preparation = prepare(context)
    showCases(context, preparation)
    console.log("")

    const { target, genre, cardAccountId, pendingAccountId } = preparation
    const created: number[] = []
    try {
        for (const probe of buildProbeCases(target, { pendingAccountId, cardAccountId }, genre)) {
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
    console.log(
        `  1. Zaimアプリで ${target.date} / ${target.amount.toLocaleString()}円 のカード明細を開く`
    )
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
    if (process.argv.includes("--create")) {
        await create(context)
        return
    }
    showPlan(context)
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
})
