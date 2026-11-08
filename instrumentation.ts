/**
 * Next.jsのサーバー起動時に一度だけ呼ばれるフック。
 *
 * - 本番プロセスのRSSの見張り（lib/process-memory-watch.ts。#1226）
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // 開発サーバーはHMRで膨らむうえ、ログが埋まるだけなので本番だけで動かす。
  if (process.env.NODE_ENV !== "production") return;

  const { startProcessMemoryWatch } = await import("@/lib/process-memory-watch");
  startProcessMemoryWatch();
}
