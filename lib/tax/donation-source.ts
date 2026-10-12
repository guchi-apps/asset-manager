// 寄付明細を読む唯一の入口（サーバー専用）。
//
// 寄付明細（`FurusatoDonation`）の正本は #715（`lib/furusato`）。件数・自治体数・未完了件数の数え方は
// `lib/furusato/summary.ts` の `summarizeDonations` に任せ、ここでは税務側の形（`DonationDetailSummary`）へ写すだけにする。
// 調整額（`Deduction.furusatoNozei`）はここでは足さない（`withAdjustment` が唯一の合成点）。
import { prisma } from "@/lib/prisma";
import { listDonationYears } from "@/lib/furusato/service";
import { summarizeDonations } from "@/lib/furusato/summary";
import type { DonationDetailSummary, DonationItem } from "./donation";

function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export async function getDonationDetails(
  userId: string,
  years: number[]
): Promise<Record<number, DonationDetailSummary>> {
  if (years.length === 0) return {};
  const rows = await prisma.furusatoDonation.findMany({
    where: { userId, year: { in: years }, deletedAt: null },
    select: {
      year: true,
      donatedAt: true,
      amount: true,
      municipality: true,
      oneStopStatus: true,
      certificateStatus: true,
    },
    orderBy: { donatedAt: "asc" },
  });

  return Object.fromEntries(
    years.map((year) => {
      const yearRows = rows.filter((row) => row.year === year);
      const summary = summarizeDonations(yearRows);
      const items: DonationItem[] = yearRows.map((row) => ({
        donatedAt: toDateOnly(row.donatedAt),
        amount: Number(row.amount),
        oneStopStatus: row.oneStopStatus,
        certificateStatus: row.certificateStatus,
      }));
      const detail: DonationDetailSummary = {
        total: summary.total,
        donationCount: summary.donationCount,
        lastDonationDate: summary.lastDonatedAt,
        municipalityCount: summary.municipalityCount,
        oneStopPendingCount: summary.oneStopPendingCount,
        certificatePendingCount: summary.certificatePendingCount,
        items,
      };
      return [year, detail];
    })
  );
}

/** 寄付明細を持つ年。年チップに「データのある年」として出すために使う */
export async function getDonationYears(userId: string): Promise<number[]> {
  return listDonationYears(userId);
}
