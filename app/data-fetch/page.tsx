import { getDataFetchPageData } from "@/app/actions/data-fetch"
import { DataFetchContent } from "@/components/data-fetch/data-fetch-content"

// 取得元（AIDE）の最新の中身を毎回読むため、キャッシュさせない。
export const dynamic = "force-dynamic"

export default async function Page() {
    const data = await getDataFetchPageData()

    return <DataFetchContent data={data} />
}
