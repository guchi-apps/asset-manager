import { getDataFetchPageData } from "@/app/actions/data-fetch"
import { DataFetchContent } from "@/components/data-fetch/data-fetch-content"

// 取得元（AIDE）の最新の中身を毎回読むため、キャッシュさせない。
export const dynamic = "force-dynamic"

/** `?open=zaim-sync` のように、開いた状態で表示するセクションを指定できる（#1109。家計簿・ホームからの導線用） */
export default async function Page({ searchParams }: { searchParams: Promise<{ open?: string }> }) {
    const [data, { open }] = await Promise.all([getDataFetchPageData(), searchParams])

    return <DataFetchContent data={data} openSection={open ?? null} />
}
