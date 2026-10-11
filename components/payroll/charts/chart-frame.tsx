"use client";

import { useEffect, useRef, type ReactNode } from "react";

import type { ChartViewMode } from "@/lib/payroll/chart-data";

const MONTHS_VISIBLE = 12;
const AXIS_MARGIN = 6; // グラフ本体の左マージン(既定5px)分の余裕
const AXIS_CHART_WIDTH = 1000;

// 表示件数が MONTHS_VISIBLE 以下のときは幅100%（=12か月分の幅）で収め、
// それを超える分は横スクロールで見られるよう幅を比例して広げる。
// 縦軸は同じグラフをもう一つ左端に重ねて描画し、縦軸部分の幅だけを
// 切り出して固定表示することで、横スクロールしても常に見えるようにする。
export function ChartFrame({
  itemCount,
  yAxisWidth,
  viewMode,
  children,
}: {
  itemCount: number;
  yAxisWidth: number;
  viewMode: ChartViewMode;
  children: ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const needsScroll = itemCount > MONTHS_VISIBLE;
  const widthPercent = Math.max(100, (itemCount / MONTHS_VISIBLE) * 100);
  const clipWidth = yAxisWidth + AXIS_MARGIN;
  // 右端へ寄せると縦軸オーバーレイの帯(clipWidth)がグラフ本体に重なり、
  // その分だけ最新側の表示件数が減ってしまうため、スクロールが必要な場合は
  // コンテンツ幅に clipWidth を上乗せして「最新 MONTHS_VISIBLE 件」を確保する。
  const contentWidth = needsScroll ? `calc(${widthPercent}% + ${clipWidth}px)` : `${widthPercent}%`;

  // データは日付昇順（古い→新しい）で並ぶため、初期表示・表示モード切替時は
  // 右端（最新データ側）にスクロールする。件数の増減（削除等）だけでは
  // スクロール位置を変えたくないため、依存は viewMode のみにする。
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollLeft = el.scrollWidth;
  }, [viewMode]);

  return (
    <div>
      <div className="mb-1 text-right text-xs text-muted-foreground">単位: 万円</div>
      <div className="relative h-[300px] md:h-[400px]">
        <div
          aria-hidden
          className="chart-axis-overlay pointer-events-none absolute inset-y-0 left-0 z-10 overflow-hidden bg-card"
          style={{ width: clipWidth }}
        >
          <div className="h-full" style={{ width: AXIS_CHART_WIDTH }}>
            {children}
          </div>
        </div>
        <div ref={scrollRef} className="h-full overflow-x-auto">
          <div style={{ width: contentWidth, minWidth: "100%" }} className="h-full">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
