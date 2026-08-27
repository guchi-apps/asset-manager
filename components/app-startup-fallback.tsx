import { AppBrandBackground, AppBrandMark, AppVersionFooter } from "@/components/app-brand";

/**
 * 最初の描画が遅れている間だけ出す起動画面。
 *
 * 表示を0.4秒遅らせている（`delay-[400ms]` + `fill-mode-both` により、遅延中は
 * fade-inの開始状態＝透明のまま）。読み込みがそれより早く終われば一度も見えないため、
 * 速いときに画面が一瞬光るのを防げる。
 */
export function AppStartupFallback() {
    return (
        <div className="relative flex min-h-screen animate-in items-center justify-center overflow-hidden bg-background fade-in fill-mode-both delay-[400ms] duration-300">
            <AppBrandBackground />

            <div className="relative z-10 flex flex-col items-center gap-4">
                <AppBrandMark />

                <div className="mt-1 h-[3px] w-[168px] overflow-hidden rounded-full bg-border">
                    <div className="animate-startup-sweep h-full w-[38%] rounded-full bg-foreground" />
                </div>

                <span className="text-xs text-muted-foreground">起動しています…</span>
            </div>

            <AppVersionFooter />
        </div>
    );
}
