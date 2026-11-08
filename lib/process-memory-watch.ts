/**
 * 本番プロセスのRSSを見張り、**最大値を更新したときだけ**ログへ出す（#1226）。
 * issue-deckの `src/lib/process-memory-watch.ts`（issue-deck#2331）と同じ形にしてある。
 *
 * ## なぜ要るのか
 *
 * PM2のプロセスはデプロイ・再起動のたびに作り直され、それまでにどこまで膨らんだかは残らない
 * （`pm2 describe` や `vps-memory-report` は「今この瞬間」しか返さない）。#1151・#1154 では
 * 上限の引き上げとネイティブヒープの修正を入れたが、本番で平常時にどこまで増えるのか、
 * 頭打ちなのか増え続けるのかを判断する材料が無かった。
 *
 * そこでプロセス自身に自分のRSSを出させる。**判定に要るのは増え方の形**なので、毎回は出さず、
 * **これまでに出した最大値を`stepMb`以上更新したときだけ**出す。
 *
 * - 頭打ちなら、起動直後に数行出たあと静かになる
 * - リークなら、増え続けるかぎり行が増える
 *
 * ## 読み方
 *
 * ```
 * [memory] rss=482MB heapTotal=217MB heapUsed=128MB external=41MB uptime=312s
 * ```
 *
 * - `rss`がPM2の`max_memory_restart`（640M）と突き合わせる値
 * - `rss`と`heapTotal`の差がヒープ外（Prismaのクエリエンジン・ICU・mallocの断片化など）。
 *   ここが大きければ `--max-old-space-size` を触っても減らない
 *
 * 本番のログは `guchi` から直接は読めないが、`vps-memory-report` が末尾の `[memory]` 行を出す。
 * 調べ方は [docs/production-memory.md](../docs/production-memory.md) を参照。
 */

/** 見張る間隔（秒）の既定値。`MEMORY_WATCH_INTERVAL_SECONDS`で変えられる */
export const MEMORY_WATCH_DEFAULT_INTERVAL_SECONDS = 60;

/**
 * ログを出す最大値の更新幅（MB）の既定値。`MEMORY_WATCH_STEP_MB`で変えられる。
 *
 * 小さすぎるとGCの揺れでログが埋まり、大きすぎると増え方の形が読めない。起動直後の
 * 約130MBから上限の640MBまでで30行程度になる幅として16MBにしている（issue-deckと同じ）。
 */
export const MEMORY_WATCH_DEFAULT_STEP_MB = 16;

const MB = 1024 * 1024;

export type ProcessMemorySample = {
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
};

/** 見張る間隔（秒）。環境変数が読めない・数値でない場合は既定値。**0以下は「見張らない」** */
export function memoryWatchIntervalSeconds(
  raw: string | undefined = process.env.MEMORY_WATCH_INTERVAL_SECONDS,
): number {
  if (raw === undefined || raw.trim() === "") return MEMORY_WATCH_DEFAULT_INTERVAL_SECONDS;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return MEMORY_WATCH_DEFAULT_INTERVAL_SECONDS;
  return value;
}

/** ログを出す最大値の更新幅（MB）。0以下は「毎回出す」ではなく既定値へ倒す */
export function memoryWatchStepMb(
  raw: string | undefined = process.env.MEMORY_WATCH_STEP_MB,
): number {
  if (raw === undefined || raw.trim() === "") return MEMORY_WATCH_DEFAULT_STEP_MB;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return MEMORY_WATCH_DEFAULT_STEP_MB;
  return value;
}

/**
 * いま出すか。**最初の1回（起動直後の基準値）は必ず出す。**
 * 以降は「これまで出した最大値 + `stepMb`」に達したときだけ出す——下がったときに出しても
 * 増え方の形は分からず、GCの揺れでログが埋まるだけのため。
 */
export function shouldLogProcessMemory(input: {
  rssBytes: number;
  lastLoggedRssBytes: number | null;
  stepMb: number;
}): boolean {
  if (input.lastLoggedRssBytes === null) return true;
  return input.rssBytes >= input.lastLoggedRssBytes + input.stepMb * MB;
}

function toMb(bytes: number): number {
  return Math.round(bytes / MB);
}

/** ログ1行。`pm2 logs`でそのまま読める形にする（JSONにしない） */
export function formatProcessMemoryLine(
  sample: ProcessMemorySample,
  uptimeSeconds: number,
): string {
  return [
    "[memory]",
    `rss=${toMb(sample.rss)}MB`,
    `heapTotal=${toMb(sample.heapTotal)}MB`,
    `heapUsed=${toMb(sample.heapUsed)}MB`,
    `external=${toMb(sample.external)}MB`,
    `uptime=${Math.round(uptimeSeconds)}s`,
  ].join(" ");
}

/**
 * 見張りを開始する。戻り値を呼ぶと止まる（テスト用。本番では止めない）。
 *
 * **タイマーは`unref()`する。** これだけが残ってもプロセスを生かし続けないようにするため
 * （Next.jsのサーバーはHTTPサーバーが握っているので実運用では差が出ないが、
 * 見張りが終了を妨げる理由は無い）。
 */
export function startProcessMemoryWatch(
  options: {
    intervalSeconds?: number;
    stepMb?: number;
    sample?: () => ProcessMemorySample;
    uptimeSeconds?: () => number;
    log?: (line: string) => void;
  } = {},
): () => void {
  const intervalSeconds = options.intervalSeconds ?? memoryWatchIntervalSeconds();
  if (intervalSeconds <= 0) return () => {};

  const stepMb = options.stepMb ?? memoryWatchStepMb();
  const sample = options.sample ?? (() => process.memoryUsage());
  const uptimeSeconds = options.uptimeSeconds ?? (() => process.uptime());
  const log = options.log ?? ((line: string) => console.log(line));

  let lastLoggedRssBytes: number | null = null;

  const tick = () => {
    const current = sample();
    if (!shouldLogProcessMemory({ rssBytes: current.rss, lastLoggedRssBytes, stepMb })) return;
    lastLoggedRssBytes = current.rss;
    log(formatProcessMemoryLine(current, uptimeSeconds()));
  };

  // 起動直後の基準値をまず1行残す。ここが無いと、あとで出た値が「どこから増えたのか」が読めない。
  tick();

  const timer = setInterval(tick, intervalSeconds * 1000);
  timer.unref?.();
  return () => clearInterval(timer);
}
