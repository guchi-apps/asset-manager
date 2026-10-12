/**
 * 明細ラボのユーザーと Asset Manager のユーザーの対応付け（Issue #717）。
 *
 * `User.id` は両アプリで別物（同じ値とは限らない）。両アプリは同じ Supabase プロジェクトを使っているため、
 * **`supabaseUserId` とメールアドレスの両方が一致したときだけ**同一人物とみなす。片方しか一致しない、
 * 対応先がいない、などは「対応不明」として、そのユーザーのデータは一切書き込まない。
 *
 * Supabase のユーザーが作り直されて `supabaseUserId` がずれた場合（#641）のように、確認済みの対応を
 * 人が指定するときは `explicit`（移行元 id → 移行先 id）で渡す。その場合もメールアドレスの一致は求める。
 */

export type MigrationUser = {
    id: string
    email: string | null
    supabaseUserId: string | null
}

export type AccountMapping =
    | { status: "mapped"; source: MigrationUser; target: MigrationUser; via: "supabaseUserId+email" | "explicit" }
    | { status: "unmapped"; source: MigrationUser; reason: string; candidates: MigrationUser[] }

const sameEmail = (a: string | null, b: string | null) =>
    a !== null && b !== null && a.trim().toLowerCase() === b.trim().toLowerCase()

export function mapAccounts(
    sources: MigrationUser[],
    targets: MigrationUser[],
    explicit: Record<string, string> = {}
): AccountMapping[] {
    const mappings = sources.map((source): AccountMapping => {
        const explicitTargetId = explicit[source.id]
        if (explicitTargetId !== undefined) {
            const target = targets.find((user) => user.id === explicitTargetId)
            if (!target) {
                return { status: "unmapped", source, reason: `指定された移行先ユーザー ${explicitTargetId} がいません`, candidates: [] }
            }
            if (!sameEmail(source.email, target.email)) {
                return {
                    status: "unmapped",
                    source,
                    reason: "指定された移行先ユーザーとメールアドレスが一致しません",
                    candidates: [target],
                }
            }
            return { status: "mapped", source, target, via: "explicit" }
        }

        const bySupabase = source.supabaseUserId
            ? targets.filter((user) => user.supabaseUserId === source.supabaseUserId)
            : []
        const byEmail = targets.filter((user) => sameEmail(user.email, source.email))
        const candidates = [...new Map([...bySupabase, ...byEmail].map((user) => [user.id, user])).values()]

        if (!source.supabaseUserId) {
            return {
                status: "unmapped",
                source,
                reason: "移行元のユーザーに supabaseUserId がありません（明細ラボへ一度もログインしていない）",
                candidates,
            }
        }
        if (bySupabase.length === 0 && byEmail.length === 0) {
            return {
                status: "unmapped",
                source,
                reason: "Asset Manager に同じユーザーがいません（先に Asset Manager へログインしてユーザーを作る）",
                candidates,
            }
        }
        const [target] = bySupabase
        if (!target) {
            return {
                status: "unmapped",
                source,
                reason: "メールアドレスは一致するが supabaseUserId が違います（Supabase のユーザーが作り直された可能性）",
                candidates,
            }
        }
        if (!sameEmail(source.email, target.email)) {
            return {
                status: "unmapped",
                source,
                reason: "supabaseUserId は一致するがメールアドレスが違います",
                candidates,
            }
        }
        return { status: "mapped", source, target, via: "supabaseUserId+email" }
    })

    // 2人の移行元が同じ移行先へ向かうと、データが1人に混ざる。どちらも書き込まない
    const counts = new Map<string, number>()
    for (const mapping of mappings) {
        if (mapping.status === "mapped") counts.set(mapping.target.id, (counts.get(mapping.target.id) ?? 0) + 1)
    }
    return mappings.map((mapping) =>
        mapping.status === "mapped" && (counts.get(mapping.target.id) ?? 0) > 1
            ? {
                  status: "unmapped",
                  source: mapping.source,
                  reason: `複数の移行元ユーザーが同じ移行先ユーザー ${mapping.target.id} に対応します`,
                  candidates: [mapping.target],
              }
            : mapping
    )
}
