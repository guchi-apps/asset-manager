import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ItemDTO } from "./types";
import { resolveEditableItems, savedItemIds } from "./editable-items";

function item(overrides: Partial<ItemDTO> & { id: string }): ItemDTO {
  return {
    userId: "u1",
    itemName: overrides.id,
    itemType: "earning",
    scope: "both",
    isTaxable: true,
    displayOrder: 0,
    isActive: true,
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

describe("savedItemIds", () => {
  it("customItemValues のうち数値の項目 ID だけを返す", () => {
    assert.deepEqual(savedItemIds({ customItemValues: { a: 100, b: "x", c: -50 } }), ["a", "c"]);
  });

  it("customItemValues が無い・不正なら空配列", () => {
    assert.deepEqual(savedItemIds(undefined), []);
    assert.deepEqual(savedItemIds({}), []);
    assert.deepEqual(savedItemIds({ customItemValues: null }), []);
  });
});

describe("resolveEditableItems", () => {
  it("有効かつ適用範囲内の項目には理由を付けない", () => {
    const [resolved] = resolveEditableItems([item({ id: "a" })], { customItemValues: { a: 1 } }, "salary");
    assert.equal(resolved.statusNote, undefined);
  });

  it("無効化した項目は（無効）を付けて残す", () => {
    const [resolved] = resolveEditableItems(
      [item({ id: "a", isActive: false })],
      { customItemValues: { a: 1 } },
      "salary"
    );
    assert.equal(resolved.id, "a");
    assert.equal(resolved.statusNote, "（無効）");
  });

  it("適用範囲外の項目は（適用範囲外）を付けて残す", () => {
    const salary = resolveEditableItems([item({ id: "a", scope: "bonus" })], {}, "salary");
    assert.equal(salary[0].statusNote, "（適用範囲外）");
    const bonus = resolveEditableItems([item({ id: "a", scope: "salary" })], {}, "bonus");
    assert.equal(bonus[0].statusNote, "（適用範囲外）");
    const both = resolveEditableItems([item({ id: "a", scope: "both" })], {}, "bonus");
    assert.equal(both[0].statusNote, undefined);
  });

  it("マスタから削除済みの項目は、明細に保存された定義の写しから復元して末尾に並べる", () => {
    const data = {
      customItemValues: { a: 100, gone: -3000 },
      itemSnapshots: {
        gone: { itemName: "前職の手当", itemType: "deduction", isTaxable: false },
      },
    };
    const resolved = resolveEditableItems([item({ id: "a", displayOrder: 5 })], data, "salary");
    assert.deepEqual(
      resolved.map((r) => r.id),
      ["a", "gone"]
    );
    assert.equal(resolved[1].itemName, "前職の手当");
    assert.equal(resolved[1].itemType, "deduction");
    assert.equal(resolved[1].isTaxable, false);
    assert.equal(resolved[1].statusNote, "（削除済み）");
  });

  it("マスタにも写しにも無い項目、種別が不正な写しは復元しない", () => {
    const data = {
      customItemValues: { unknown: 1, broken: 2 },
      itemSnapshots: { broken: { itemName: "x", itemType: "nope", isTaxable: true } },
    };
    assert.deepEqual(resolveEditableItems([], data, "bonus"), []);
  });

  it("displayOrder 順に並べる", () => {
    const resolved = resolveEditableItems(
      [item({ id: "b", displayOrder: 2 }), item({ id: "a", displayOrder: 1, isActive: false })],
      {},
      "salary"
    );
    assert.deepEqual(
      resolved.map((r) => r.id),
      ["a", "b"]
    );
  });
});
