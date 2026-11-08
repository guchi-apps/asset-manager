import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  formatProcessMemoryLine,
  MEMORY_WATCH_DEFAULT_INTERVAL_SECONDS,
  MEMORY_WATCH_DEFAULT_STEP_MB,
  memoryWatchIntervalSeconds,
  memoryWatchStepMb,
  shouldLogProcessMemory,
  startProcessMemoryWatch,
  type ProcessMemorySample,
} from "./process-memory-watch";

const MB = 1024 * 1024;

function sample(rssMb: number): ProcessMemorySample {
  return {
    rss: rssMb * MB,
    heapTotal: 217 * MB,
    heapUsed: 128 * MB,
    external: 41 * MB,
  };
}

describe("memoryWatchIntervalSeconds", () => {
  it("環境変数が無ければ既定値", () => {
    assert.equal(memoryWatchIntervalSeconds(undefined), MEMORY_WATCH_DEFAULT_INTERVAL_SECONDS);
    assert.equal(memoryWatchIntervalSeconds("  "), MEMORY_WATCH_DEFAULT_INTERVAL_SECONDS);
  });

  it("数値でなければ既定値へ倒す", () => {
    assert.equal(memoryWatchIntervalSeconds("abc"), MEMORY_WATCH_DEFAULT_INTERVAL_SECONDS);
    assert.equal(memoryWatchIntervalSeconds("-1"), MEMORY_WATCH_DEFAULT_INTERVAL_SECONDS);
  });

  it("0は「見張らない」として尊重する", () => {
    assert.equal(memoryWatchIntervalSeconds("0"), 0);
  });
});

describe("memoryWatchStepMb", () => {
  it("読めない値は既定値へ倒す", () => {
    assert.equal(memoryWatchStepMb(undefined), MEMORY_WATCH_DEFAULT_STEP_MB);
    assert.equal(memoryWatchStepMb("0"), MEMORY_WATCH_DEFAULT_STEP_MB);
    assert.equal(memoryWatchStepMb("abc"), MEMORY_WATCH_DEFAULT_STEP_MB);
  });

  it("正の数はそのまま使う", () => {
    assert.equal(memoryWatchStepMb("32"), 32);
  });
});

describe("shouldLogProcessMemory", () => {
  it("最初の1回は必ず出す", () => {
    assert.equal(shouldLogProcessMemory({ rssBytes: 150 * MB, lastLoggedRssBytes: null, stepMb: 16 }), true);
  });

  it("最大値を更新幅ぶん超えたときだけ出す", () => {
    assert.equal(shouldLogProcessMemory({ rssBytes: 165 * MB, lastLoggedRssBytes: 150 * MB, stepMb: 16 }), false);
    assert.equal(shouldLogProcessMemory({ rssBytes: 166 * MB, lastLoggedRssBytes: 150 * MB, stepMb: 16 }), true);
  });

  it("下がったときは出さない（GCの揺れでログを埋めない）", () => {
    assert.equal(shouldLogProcessMemory({ rssBytes: 100 * MB, lastLoggedRssBytes: 480 * MB, stepMb: 16 }), false);
  });
});

describe("formatProcessMemoryLine", () => {
  it("pm2 logsでそのまま読める1行にする", () => {
    assert.equal(formatProcessMemoryLine(sample(482), 312.4), "[memory] rss=482MB heapTotal=217MB heapUsed=128MB external=41MB uptime=312s");
  });
});

describe("startProcessMemoryWatch", () => {
  it("起動直後の基準値を1行だけ出す", () => {
    const lines: string[] = [];
    const stop = startProcessMemoryWatch({
      intervalSeconds: 60,
      stepMb: 16,
      sample: () => sample(150),
      uptimeSeconds: () => 1,
      log: (line) => lines.push(line),
    });
    stop();

    assert.equal(lines.length, 1);
    assert.ok(lines[0].includes("rss=150MB"));
  });

  it("間隔が0なら何も出さず、タイマーも張らない", () => {
    const lines: string[] = [];
    const stop = startProcessMemoryWatch({
      intervalSeconds: 0,
      sample: () => sample(150),
      log: (line) => lines.push(line),
    });
    stop();

    assert.deepEqual(lines, []);
  });
});
