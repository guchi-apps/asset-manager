"use client"

/**
 * 設定タブの「内訳の表示」（Issue #322）。
 *
 * 使わない内訳を隠して、内訳ピッカーの一覧を短くする。**隠すのは選択肢の削除ではない。**
 * 隠した内訳も検索には出るし、ピッカーの「隠した内訳も出す」から選べる。
 *
 * ここでの設定はZaimへ送らない。Zaimのマスタを取り直しても残る
 * （`syncZaimMasters` の upsert が `hidden` を更新しないため）。
 */

import * as React from "react"
import { ChevronDown, ChevronRight, Eye, EyeOff, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import {
    getZaimGenreCatalogAction,
    hideUnusedZaimGenresAction,
    setZaimGenreHiddenAction,
    showAllZaimGenresAction,
} from "@/app/actions/kakeibo"
import { groupGenresByCategory, type ZaimGenreChoice } from "@/lib/zaim-genre-choices"

export function GenreVisibilitySettings({ zaimConfigured }: { zaimConfigured: boolean }) {
    const [genres, setGenres] = React.useState<ZaimGenreChoice[]>([])
    const [loading, setLoading] = React.useState(true)
    const [busy, setBusy] = React.useState(false)
    const [openCategoryIds, setOpenCategoryIds] = React.useState<Set<number>>(new Set())

    const load = React.useCallback(async () => {
        const result = await getZaimGenreCatalogAction()
        if (result.success) setGenres(result.data.genres)
        setLoading(false)
    }, [])

    React.useEffect(() => {
        void load()
    }, [load])

    const groups = React.useMemo(() => groupGenresByCategory(genres), [genres])
    const visibleCount = genres.filter((genre) => !genre.hidden).length

    const toggleCategory = (zaimCategoryId: number) => {
        setOpenCategoryIds((previous) => {
            const next = new Set(previous)
            if (next.has(zaimCategoryId)) next.delete(zaimCategoryId)
            else next.add(zaimCategoryId)
            return next
        })
    }

    const toggleGenre = async (genre: ZaimGenreChoice) => {
        const hidden = !genre.hidden
        // 押した瞬間に反映する。失敗したら読み直して元へ戻す。
        setGenres((previous) =>
            previous.map((entry) =>
                entry.zaimGenreId === genre.zaimGenreId ? { ...entry, hidden } : entry
            )
        )
        const result = await setZaimGenreHiddenAction(genre.zaimGenreId, hidden)
        if (!result.success) {
            toast.error(result.error)
            await load()
        }
    }

    const hideUnused = async () => {
        setBusy(true)
        try {
            const result = await hideUnusedZaimGenresAction()
            if (!result.success) {
                toast.error(result.error)
                return
            }
            if (result.data.hidden === 0 && result.data.kept === 0) {
                toast.info("分類履歴がまだ無いため、隠す内訳を決められませんでした")
            } else {
                toast.success(
                    result.data.hidden + " 件を隠し、使った実績のある " + result.data.kept + " 件を残しました"
                )
            }
            await load()
        } finally {
            setBusy(false)
        }
    }

    const showAll = async () => {
        setBusy(true)
        try {
            const result = await showAllZaimGenresAction()
            if (!result.success) {
                toast.error(result.error)
                return
            }
            toast.success(result.data.restored + " 件を表示に戻しました")
            await load()
        } finally {
            setBusy(false)
        }
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">内訳の表示</CardTitle>
                <CardDescription>
                    使わない内訳を隠すと、内訳を選ぶときの一覧が短くなります。隠した内訳も、検索と
                    ピッカーの「隠した内訳も出す」から選べます。Zaimのマスタを取り直しても、ここでの設定は残ります。
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" size="sm" onClick={showAll} disabled={busy || loading}>
                        {busy ? <Loader2 className="animate-spin" /> : <Eye />}
                        すべて表示にする
                    </Button>
                    <Button variant="outline" size="sm" onClick={hideUnused} disabled={busy || loading}>
                        {busy ? <Loader2 className="animate-spin" /> : <EyeOff />}
                        使った実績のない内訳を隠す
                    </Button>
                    <span className="text-muted-foreground ml-auto text-xs tabular-nums">
                        表示中 {visibleCount} / 全 {genres.length}
                    </span>
                </div>

                {loading && <p className="text-muted-foreground py-6 text-center text-sm">読み込んでいます…</p>}

                {!loading && genres.length === 0 && (
                    <p className="text-muted-foreground py-6 text-center text-sm">
                        {zaimConfigured
                            ? "「Zaimのマスタを取得」を押すと、内訳がここに並びます"
                            : "Zaim APIの設定が済むと使えます"}
                    </p>
                )}

                {groups.map((group) => {
                    const opened = openCategoryIds.has(group.zaimCategoryId)
                    return (
                        <div key={group.zaimCategoryId} className="border-t pt-2">
                            <button
                                type="button"
                                onClick={() => toggleCategory(group.zaimCategoryId)}
                                className="flex w-full items-center gap-2 text-left text-sm font-medium"
                                aria-expanded={opened}
                            >
                                {opened ? (
                                    <ChevronDown className="text-muted-foreground size-3.5" />
                                ) : (
                                    <ChevronRight className="text-muted-foreground size-3.5" />
                                )}
                                <span className="min-w-0 truncate">{group.categoryName}</span>
                                <span className="text-muted-foreground ml-auto text-xs font-normal tabular-nums">
                                    {group.visibleCount} / {group.genres.length} を表示
                                </span>
                            </button>

                            {opened && (
                                <div className="grid grid-cols-2 gap-x-4 gap-y-2 pt-2 pb-1 sm:grid-cols-3 lg:grid-cols-4">
                                    {group.genres.map((genre) => (
                                        <label
                                            key={genre.zaimGenreId}
                                            className={
                                                "flex items-center gap-2 text-xs " +
                                                (genre.hidden ? "text-muted-foreground" : "")
                                            }
                                        >
                                            <Switch
                                                size="sm"
                                                checked={!genre.hidden}
                                                onCheckedChange={() => void toggleGenre(genre)}
                                                aria-label={genre.genreName + " を表示する"}
                                            />
                                            <span className="min-w-0 truncate">{genre.genreName}</span>
                                        </label>
                                    ))}
                                </div>
                            )}
                        </div>
                    )
                })}
            </CardContent>
        </Card>
    )
}
