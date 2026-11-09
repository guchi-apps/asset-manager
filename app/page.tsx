import { getDashboardData } from "./actions/dashboard";
import { getDataFetchAlert, getValuationFetchedAt } from "./actions/data-fetch";
import { DataFetchAlertBanner } from "@/components/dashboard/data-fetch-alert";
import { DashboardContent } from "@/components/dashboard/dashboard-content";
import { HomeLedgerSummary } from "@/components/dashboard/home-ledger-summary";
import { CardWithdrawalBanner } from "@/components/dashboard/card-withdrawal-banner";
import { getCardWithdrawals, getLedgerPageData, getLedgerSyncStatus } from "./actions/ledger";

export const dynamic = "force-dynamic";

/**
 * ホームは全体のサマリーだけを出す（Issue #914）。アセット別の詳細・グラフ・今期の入金額は
 * 投資資産の画面（`/assets`）へ移した。
 */
export default async function Page() {
    const [{ categories, history }, dataFetchAlert, fetchedAt, ledger, ledgerSync, cardWithdrawals] = await Promise.all([
        getDashboardData(),
        // 取得エラーの案内は補助情報なので、読めなくてもホームは表示する
        getDataFetchAlert().catch(() => null),
        // 「取得 ○時間前」の表示（#1283）も補助情報。読めなければ出さないだけにする
        getValuationFetchedAt().catch(() => null),
        // 家計簿の欄（Issue #819）も、読めなければ出さないだけにして資産の表示は止めない
        getLedgerPageData(0).catch(() => null),
        getLedgerSyncStatus().catch(() => null),
        // カードの引き落とし口座の残高確認（Issue #1141）も補助情報。読めなくてもホームは表示する
        getCardWithdrawals().catch(() => null),
    ]);

    return (
        <>
        {dataFetchAlert && (
            <div className="px-1 pt-2 md:px-2 md:pt-4">
                <DataFetchAlertBanner alert={dataFetchAlert} />
            </div>
        )}
        {cardWithdrawals && (
            <div className="px-1 pt-2 md:px-2 md:pt-4">
                <CardWithdrawalBanner data={cardWithdrawals} />
            </div>
        )}
        {/* 上に資産、下に今月のお金の動き。画面幅によらずこの順（Issue #1177） */}
        <div className="flex flex-col pb-4">
            <section className="px-1 pt-2 md:px-2 md:pt-4">
                <DashboardContent categories={categories} history={history} accounts={ledger?.accounts} fetchedAt={fetchedAt} />
            </section>
            {ledger && <HomeLedgerSummary data={ledger} sync={ledgerSync} />}
        </div>
        </>
    );
}
