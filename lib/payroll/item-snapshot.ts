// 明細（給与・賞与）の保存時点の項目定義を `data.itemSnapshots` に持たせ、集計ではそちらを優先する（#212）。
//
// 項目マスタ（Item）の名前・種別・課税対象は後から編集・削除できる。集計が常に「現在の」マスタを見ると、
// 通勤手当を今年から課税扱いに切り替えただけで過去年の確定申告・住民税の計算まで変わってしまう。
// そこで明細の保存時に、金額を持つ項目の定義をその明細へ写し取り、集計・計算はその写しを正とする。
//
// 写しを持たない明細（この機能の導入前に保存したもの）は、従来どおり現在のマスタで判定する。
// クライアントからも import できるよう、この lib は `db` に依存させない。

export type ItemDefinition = {
  itemName: string;
  itemType: string;
  isTaxable: boolean;
};

export type ItemSnapshots = Record<string, ItemDefinition>;

type ItemWithId = ItemDefinition & { id: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isItemDefinition(value: unknown): value is ItemDefinition {
  return (
    isRecord(value) &&
    typeof value.itemName === "string" &&
    typeof value.itemType === "string" &&
    typeof value.isTaxable === "boolean"
  );
}

export function readItemSnapshots(data: unknown): ItemSnapshots {
  if (!isRecord(data) || !isRecord(data.itemSnapshots)) return {};
  return Object.fromEntries(
    Object.entries(data.itemSnapshots).filter((entry): entry is [string, ItemDefinition] =>
      isItemDefinition(entry[1])
    )
  );
}

/**
 * 明細に載っている項目 ID とその定義の組を返す。
 * 定義は、明細に保存された写し → 現在の項目マスタ の順で解決する（どちらにも無い項目は含めない）。
 */
export function resolveCustomItems(
  data: unknown,
  currentItemsById: ReadonlyMap<string, ItemDefinition>
): { itemId: string; value: number; definition: ItemDefinition }[] {
  if (!isRecord(data) || !isRecord(data.customItemValues)) return [];
  const snapshots = readItemSnapshots(data);

  const resolved: { itemId: string; value: number; definition: ItemDefinition }[] = [];
  for (const [itemId, value] of Object.entries(data.customItemValues)) {
    if (typeof value !== "number") continue;
    const definition = snapshots[itemId] ?? currentItemsById.get(itemId);
    if (definition) resolved.push({ itemId, value, definition });
  }
  return resolved;
}

export function toItemMap(items: ItemWithId[]): Map<string, ItemDefinition> {
  return new Map(
    items.map((item) => [
      item.id,
      { itemName: item.itemName, itemType: item.itemType, isTaxable: item.isTaxable },
    ])
  );
}

/**
 * 保存する `data` に、金額を持つ項目の定義の写しを付ける。
 * すでに明細に写しがある項目は上書きしない（明細を編集し直しただけで、保存時点の区分が今の区分に
 * 置き換わらないようにするため）。`data` に `customItemValues` が無ければ写しを付けない。
 *
 * リクエストで渡ってきた `data.itemSnapshots` は信頼せず常に捨てる。写しはサーバーだけが、
 * 保存済みの明細（`existingData`）と現在の項目マスタから組み立てる。クライアントの入力を通すと、
 * 確定済みの過去の課税区分を後から書き換えられてしまう。
 */
export function attachItemSnapshots(
  data: Record<string, unknown>,
  currentItems: ItemWithId[],
  existingData?: unknown
): Record<string, unknown> {
  const rest = { ...data };
  delete rest.itemSnapshots;
  const customItemValues = rest.customItemValues;
  if (!isRecord(customItemValues)) return rest;

  const currentById = toItemMap(currentItems);
  const previous = readItemSnapshots(existingData);

  const snapshots: ItemSnapshots = {};
  for (const itemId of Object.keys(customItemValues)) {
    const definition = previous[itemId] ?? currentById.get(itemId);
    if (definition) snapshots[itemId] = definition;
  }
  return { ...rest, itemSnapshots: snapshots };
}
