// 給与・賞与の編集画面に渡す項目を決める（#211）。
//
// 編集画面が「有効かつ適用範囲が合う項目」だけを読み込むと、その明細に金額が載っていても、後から無効化・
// 適用範囲の変更・削除をした項目は入力欄も集計にも現れない。保存時にその項目の金額が消え、支給額・手取額が
// 黙って変わってしまう。そこで、明細の `customItemValues` に金額がある項目は状態に関係なく読み込む。
// 項目マスタから削除済みの項目は、明細に保存された定義の写し（`data.itemSnapshots`）から復元する。
//
// クライアントからも import できるよう、この lib は `db` に依存させない。
import type { EditableItemDTO, ItemDTO, ItemType } from "./types";
import { readItemSnapshots } from "./item-snapshot";

export type ItemUsage = "salary" | "bonus";

const ITEM_TYPES: readonly string[] = [
  "earning",
  "otherEarning",
  "otherTaxable",
  "statutoryDeduction",
  "deduction",
] satisfies ItemType[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 明細（`data`）に金額を持つ項目の ID。 */
export function savedItemIds(data: unknown): string[] {
  if (!isRecord(data) || !isRecord(data.customItemValues)) return [];
  return Object.entries(data.customItemValues)
    .filter((entry) => typeof entry[1] === "number")
    .map(([itemId]) => itemId);
}

function statusNote(item: ItemDTO, usage: ItemUsage): string | undefined {
  if (!item.isActive) return "（無効）";
  if (item.scope !== "both" && item.scope !== usage) return "（適用範囲外）";
  return undefined;
}

/**
 * 編集画面に渡す項目を返す。
 * `items` は現在の項目マスタから読んだ項目（有効・適用範囲内の項目に加えて、明細に金額がある項目を含める）。
 * 明細に金額がある項目のうちマスタに無いものは、明細に保存された定義の写しから補う。
 * 無効・適用範囲外・削除済みの項目には `statusNote` を付け、画面に理由を出せるようにする。
 */
export function resolveEditableItems(
  items: ItemDTO[],
  data: unknown,
  usage: ItemUsage
): EditableItemDTO[] {
  const resolved: EditableItemDTO[] = items.map((item) => ({
    ...item,
    statusNote: statusNote(item, usage),
  }));

  const snapshots = readItemSnapshots(data);
  const knownIds = new Set(items.map((item) => item.id));
  for (const itemId of savedItemIds(data)) {
    const snapshot = snapshots[itemId];
    if (knownIds.has(itemId) || !snapshot || !ITEM_TYPES.includes(snapshot.itemType)) continue;
    resolved.push({
      id: itemId,
      userId: "",
      itemName: snapshot.itemName,
      itemType: snapshot.itemType as ItemType,
      scope: usage,
      isTaxable: snapshot.isTaxable,
      displayOrder: Number.MAX_SAFE_INTEGER,
      isActive: false,
      createdAt: "",
      updatedAt: "",
      statusNote: "（削除済み）",
    });
  }

  // 元の並び（displayOrder 順）を保つ。削除済みの項目は末尾に並ぶ
  return resolved.sort((a, b) => a.displayOrder - b.displayOrder);
}
