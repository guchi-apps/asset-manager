// 承認画面・承認状態の読み取りAPIのパス（Issue #798）。クライアント・サーバーのどちらからも使えるよう、依存を持たせない。

/** 本人が承認画面を開くパス（画面はログイン済みの本人だけが開ける） */
export function salaryAgentApprovalPath(previewId: string): string {
    return `/salaries/agent/approvals/${encodeURIComponent(previewId)}`
}

/** 承認状態を読む口。状態とIDだけを返す */
export function salaryAgentApprovalReadPath(previewId: string): string {
    return `/api/salaries/agent/approvals/${encodeURIComponent(previewId)}`
}
