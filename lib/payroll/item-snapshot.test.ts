// 明細に保存する項目定義の写し（item-snapshot.ts）の単体テスト（#714。明細ラボ#212の挙動を引き継ぐ）
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { attachItemSnapshots, resolveCustomItems, toItemMap } from "./item-snapshot";

const commute = { id: "commute", itemName: "通勤手当", itemType: "earning", isTaxable: false };
const remote = { id: "remote", itemName: "在宅勤務手当", itemType: "earning", isTaxable: true };

describe("attachItemSnapshots", () => {
  it("金額を持つ項目の定義だけを写す", () => {
    const data = attachItemSnapshots({ customItemValues: { commute: 16000 } }, [commute, remote]);
    assert.deepEqual(data.itemSnapshots, {
      commute: { itemName: "通勤手当", itemType: "earning", isTaxable: false },
    });
  });

  it("クライアントが送った写しは捨て、保存済みの写しを優先する", () => {
    const existing = {
      customItemValues: { commute: 16000 },
      itemSnapshots: { commute: { itemName: "通勤手当", itemType: "earning", isTaxable: false } },
    };
    // 今は課税扱いに変わっていても、保存済みの明細の区分は変えない
    const data = attachItemSnapshots(
      {
        customItemValues: { commute: 16000 },
        itemSnapshots: { commute: { itemName: "改ざん", itemType: "deduction", isTaxable: true } },
      },
      [{ ...commute, isTaxable: true }],
      existing
    );
    assert.deepEqual(data.itemSnapshots, existing.itemSnapshots);
  });

  it("customItemValues が無ければ写しを付けない", () => {
    assert.deepEqual(attachItemSnapshots({ baseGrossSalary: 300000, itemSnapshots: {} }, [commute]), {
      baseGrossSalary: 300000,
    });
  });
});

describe("resolveCustomItems", () => {
  it("写し → 現在の項目マスタの順で定義を引き、どちらにも無い項目は落とす", () => {
    const data = {
      customItemValues: { commute: 16000, remote: 7000, deleted: 500 },
      itemSnapshots: { commute: { itemName: "通勤手当", itemType: "earning", isTaxable: false } },
    };
    const resolved = resolveCustomItems(data, toItemMap([{ ...commute, isTaxable: true }, remote]));
    assert.deepEqual(
      resolved.map(({ itemId, definition }) => [itemId, definition.isTaxable]),
      [
        ["commute", false],
        ["remote", true],
      ]
    );
  });
});
