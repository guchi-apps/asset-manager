/**
 * 画面の描画中に起きたエラーを、利用者向けの日本語の説明へ変換する（Issue #1089）。
 *
 * `app/error.tsx`・`app/global-error.tsx` が受け取る Error を種類に分けて、見出し・原因・対処を返す。
 * 元の英語の内容は「詳しい情報」として別に残す（報告・調査に使うため）。
 */

export type ErrorKind = "chunk" | "network" | "server" | "render"

export type ErrorExplanation = {
    kind: ErrorKind
    /** 種類を表す短いラベル（バッジに出す） */
    label: string
    /** 何が起きたか */
    cause: string
    /** どうすればよいか */
    advice: string
}

export type ErrorLike = {
    name?: string
    message?: string
    digest?: string
}

// アプリの更新後に、古い版のビルドが参照するファイル（チャンク）を読めずに落ちたときの文言。
// webpack は ChunkLoadError、ブラウザのネイティブな動的 import は各ブラウザ固有の文言を出す。
const CHUNK_PATTERNS = [
    /ChunkLoadError/i,
    /Loading chunk \S+ failed/i,
    /Loading CSS chunk/i,
    /Failed to fetch dynamically imported module/i, // Chrome
    /error loading dynamically imported module/i, // Firefox
    /Importing a module script failed/i, // Safari
    /Failed to load chunk/i, // Turbopack
]

// 通信が途切れたときの fetch の失敗。Safari は "Load failed"、Chrome は "Failed to fetch"、
// Firefox は "NetworkError when attempting to fetch resource."
const NETWORK_PATTERNS = [
    /Failed to fetch/i,
    /^Load failed$/i,
    /NetworkError/i,
    /Network request failed/i,
    /The network connection was lost/i,
    /The Internet connection appears to be offline/i,
    /ERR_INTERNET_DISCONNECTED/i,
    /ERR_NETWORK_CHANGED/i,
]

// 本番ではサーバー側（Server Components・サーバーアクション）のエラー内容が伏せられ、
// この定型文と digest だけが届く
const SERVER_PATTERNS = [
    /An error occurred in the Server Components render/i,
    /Server Components render/i,
    /An unexpected response was received from the server/i,
]

function matches(patterns: RegExp[], text: string): boolean {
    return patterns.some((pattern) => pattern.test(text))
}

export function classifyError(error: ErrorLike): ErrorKind {
    const name = error.name ?? ""
    const message = error.message ?? ""
    const text = `${name}: ${message}`

    if (name === "ChunkLoadError" || matches(CHUNK_PATTERNS, text)) return "chunk"
    if (matches(NETWORK_PATTERNS, message)) return "network"
    if (matches(SERVER_PATTERNS, message)) return "server"
    // digest はサーバーで起きたエラーにだけ付く
    if (error.digest) return "server"
    return "render"
}

const EXPLANATIONS: Record<ErrorKind, Omit<ErrorExplanation, "kind">> = {
    chunk: {
        label: "アプリの更新",
        cause: "アプリが新しい版に更新されたため、古い版のファイルを読み込めませんでした。",
        advice: "「アプリを再起動」を押すと、新しい版で開き直します。",
    },
    network: {
        label: "通信のエラー",
        cause: "サーバーとの通信に失敗しました。電波の弱い場所にいるか、通信が一時的に途切れた可能性があります。",
        advice: "通信できる状態で「もう一度試す」を押してください。直らないときは「アプリを再起動」を押してください。",
    },
    server: {
        label: "サーバーのエラー",
        cause: "サーバーでデータを準備している途中でエラーが起きました。",
        advice: "少し時間をおいて「もう一度試す」を押してください。繰り返し起きるときは「詳しい情報」をコピーして報告してください。",
    },
    render: {
        label: "表示処理のエラー",
        cause: "画面を組み立てる途中で予期しない問題が起きました。アプリの不具合の可能性があります。",
        advice: "「もう一度試す」か「アプリを再起動」を押してください。繰り返し起きるときは「詳しい情報」をコピーして報告してください。",
    },
}

export function explainError(error: ErrorLike): ErrorExplanation {
    const kind = classifyError(error)
    return { kind, ...EXPLANATIONS[kind] }
}

export type ErrorDetailRow = { label: string; value: string }

/** 「詳しい情報」に並べる行。空の値は省く */
export function errorDetailRows(
    error: ErrorLike,
    context: { pathname?: string; occurredAt?: string; version?: string },
): ErrorDetailRow[] {
    const rows: ErrorDetailRow[] = [
        { label: "種類", value: error.name ?? "" },
        { label: "内容", value: error.message ?? "" },
        { label: "画面", value: context.pathname ?? "" },
        { label: "日時", value: context.occurredAt ?? "" },
        { label: "バージョン", value: context.version ? `v${context.version}` : "" },
        { label: "識別子", value: error.digest ?? "" },
    ]
    return rows.filter((row) => row.value.trim() !== "")
}

/** コピー用のテキスト（1行1項目） */
export function formatErrorDetails(rows: ErrorDetailRow[]): string {
    return rows.map((row) => `${row.label}: ${row.value}`).join("\n")
}

/** 更新由来のエラーで自動再読み込みしてよいか。直近に一度試していれば、ループを避けるため試さない */
export const CHUNK_RELOAD_STORAGE_KEY = "asset-manager:chunk-reload-at"
export const CHUNK_RELOAD_COOLDOWN_MS = 60_000

export function shouldAutoReload(kind: ErrorKind, lastReloadAt: number | null, now: number): boolean {
    if (kind !== "chunk") return false
    if (lastReloadAt === null || !Number.isFinite(lastReloadAt)) return true
    return now - lastReloadAt > CHUNK_RELOAD_COOLDOWN_MS
}
