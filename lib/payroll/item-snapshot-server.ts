// サーバー専用（`db` に依存する）。クライアントコンポーネントから import しないこと。
import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  attachItemSnapshots,
  readItemSnapshots,
  type ItemDefinition,
} from "@/lib/payroll/item-snapshot";

// 給与・賞与の保存APIから呼び、`data.customItemValues` の各項目について保存時点の定義を写し取る。
// 金額を持つ項目が無い（`customItemValues` が無い・空）ときは項目マスタを引かずにそのまま返す。
export async function withItemSnapshots(
  userId: string,
  data: Record<string, unknown>,
  existingData?: unknown
): Promise<Record<string, unknown>> {
  const customItemValues = data.customItemValues;
  const itemIds =
    typeof customItemValues === "object" && customItemValues !== null
      ? Object.keys(customItemValues)
      : [];
  if (itemIds.length === 0) return attachItemSnapshots(data, [], existingData);

  const items = await prisma.payItem.findMany({
    where: { userId, id: { in: itemIds } },
    select: { id: true, itemName: true, itemType: true, isTaxable: true },
  });
  return attachItemSnapshots(data, items, existingData);
}

// 項目の名前・種別・課税対象を変える／項目を削除する直前に呼び、変更前の定義をまだ写しを持たない明細へ写し取る。
// 写しは明細の保存時に付くが、導入前に保存した明細には無く、そのままだと項目の変更が過去年の集計へ遡って
// 効いてしまう（#212）。写しがすでにある明細は保存時点の定義を保つため触らない。
// 項目の更新・削除と同じトランザクションで呼ぶこと。
export async function freezeItemDefinition(
  tx: Prisma.TransactionClient,
  userId: string,
  item: { id: string } & ItemDefinition
): Promise<void> {
  const definition: ItemDefinition = {
    itemName: item.itemName,
    itemType: item.itemType,
    isTaxable: item.isTaxable,
  };

  function needsFreeze(data: unknown): data is Record<string, unknown> {
    if (typeof data !== "object" || data === null) return false;
    const customItemValues = (data as Record<string, unknown>).customItemValues;
    if (typeof customItemValues !== "object" || customItemValues === null) return false;
    return item.id in customItemValues && !(item.id in readItemSnapshots(data));
  }

  function frozen(data: Record<string, unknown>): Prisma.InputJsonValue {
    return {
      ...data,
      itemSnapshots: { ...readItemSnapshots(data), [item.id]: definition },
    } as Prisma.InputJsonValue;
  }

  const [salaries, bonuses] = await Promise.all([
    tx.salary.findMany({ where: { userId }, select: { id: true, data: true } }),
    tx.bonus.findMany({ where: { userId }, select: { id: true, data: true } }),
  ]);

  for (const salary of salaries) {
    if (needsFreeze(salary.data)) {
      await tx.salary.update({ where: { id: salary.id }, data: { data: frozen(salary.data) } });
    }
  }
  for (const bonus of bonuses) {
    if (needsFreeze(bonus.data)) {
      await tx.bonus.update({ where: { id: bonus.id }, data: { data: frozen(bonus.data) } });
    }
  }
}
