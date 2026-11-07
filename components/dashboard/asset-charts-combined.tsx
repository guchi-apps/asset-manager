"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { HistoryPoint, Category, TagGroup, ChartViewMode } from "@/types/asset"

const AssetHistoryChart = dynamic(
    () => import("@/components/dashboard/asset-history-chart").then(m => m.AssetHistoryChart),
    { ssr: false, loading: () => <Skeleton className="h-full w-full min-h-64" /> }
)
const AssetAllocationChart = dynamic(
    () => import("@/components/dashboard/asset-allocation-chart").then(m => m.AssetAllocationChart),
    { ssr: false, loading: () => <Skeleton className="h-full w-full min-h-64" /> }
)

interface AssetChartsCombinedProps {
    historyData: HistoryPoint[];
    categories: Category[];
    tagGroups: TagGroup[];
    initialTimeRange: string;
}

export function AssetChartsCombined({
    historyData,
    categories,
    tagGroups,
    initialTimeRange
}: AssetChartsCombinedProps) {
    const [mode, setMode] = React.useState<"total" | "tag">("total")
    const [selectedTagGroup, setSelectedTagGroup] = React.useState<number>(1)
    const [activePoint, setActivePoint] = React.useState<HistoryPoint | null>(null)
    const [selectedAssetKey, setSelectedAssetKey] = React.useState<string | null>(null)
    const [viewMode, setViewMode] = React.useState<ChartViewMode>("value")
    // 渡されるカテゴリ・履歴は投資用途だけに絞り込み済み（#965）。「投資以外を含める」の切り替えは廃止した
    const categoriesForCharts = categories

    // カテゴリが変更されたら選択を解除
    React.useEffect(() => {
        setSelectedAssetKey(null)
    }, [mode, selectedTagGroup])

    React.useEffect(() => {
        if (tagGroups && tagGroups.length > 0) {
            const exists = tagGroups.find(g => g.id === selectedTagGroup)
            if (!exists) setSelectedTagGroup(tagGroups[0].id)
        }
    }, [tagGroups, selectedTagGroup])

    return (
        <Card className="flex flex-col overflow-hidden">
            <CardHeader className="items-center pb-1 pt-3 border-b gap-2">
                <div className="w-full flex items-center gap-2 overflow-x-auto no-scrollbar max-w-full">
                    <div className="flex bg-muted/50 rounded-md p-0.5 border">
                        <button
                            onClick={() => setMode("total")}
                            className={`px-3 py-1 text-[11px] font-medium rounded-md transition-all whitespace-nowrap ${mode === "total"
                                ? "bg-background text-foreground shadow-sm font-bold"
                                : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
                        >
                            全体
                        </button>
                        {tagGroups && tagGroups.map(grp => (
                            <button
                                key={grp.id}
                                onClick={() => {
                                    setMode("tag");
                                    setSelectedTagGroup(grp.id);
                                }}
                                className={`px-3 py-1 text-[11px] font-medium rounded-md transition-all whitespace-nowrap ${mode === "tag" && selectedTagGroup === grp.id
                                    ? "bg-background text-foreground shadow-sm font-bold"
                                    : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
                            >
                                {grp.name}
                            </button>
                        ))}
                    </div>
                </div>
            </CardHeader>


            <CardContent className="p-0 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-7">
                {/* 円グラフ（PCでは左側、モバイルでは上） */}
                <div className="col-span-1 md:col-span-1 lg:col-span-3 min-w-0 flex flex-col relative w-full h-full">
                    <AssetAllocationChart
                        categories={categoriesForCharts}
                        tagGroups={tagGroups} 
                        mode={mode} 
                        selectedTagGroup={selectedTagGroup}
                        activePoint={activePoint}
                        selectedAssetKey={selectedAssetKey}
                        onAssetClick={setSelectedAssetKey}
                        viewMode={viewMode}
                    />
                </div>

                {/* 折れ線グラフ（PCでは右側、モバイルでは下） */}
                <div className="col-span-1 lg:col-span-4 min-w-0 flex flex-col relative lg:border-l lg:border-t-0 border-t w-full h-full">
                    <AssetHistoryChart
                        data={historyData}
                        categories={categoriesForCharts}
                        tagGroups={tagGroups} 
                        initialTimeRange={initialTimeRange} 
                        mode={mode} 
                        selectedTagGroup={selectedTagGroup}
                        onActivePointChange={setActivePoint}
                        selectedAssetKey={selectedAssetKey}
                        viewMode={viewMode}
                        onViewModeChange={setViewMode}
                    />
                </div>
            </CardContent>
        </Card>
    )
}
