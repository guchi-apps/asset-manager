import assert from "node:assert/strict"
import { test } from "node:test"
import { existingGroupNames, flattenAccountSections, groupAccounts } from "./ledger-account-groups"

const acc = (id: number, groupName: string | null, balance: number) => ({ id, groupName, balance })
const bal = (a: { balance: number }) => a.balance

test("グループが1つも無ければ空（従来表示）", () => {
    assert.deepEqual(groupAccounts([acc(1, null, 10)], bal), [])
})

test("最初に出た順にまとめ、未分類は最後・小計を出す", () => {
    const groups = groupAccounts([acc(1, null, 5), acc(2, "投資", 100), acc(3, "日常", 30), acc(4, "投資", -20)], bal)
    assert.deepEqual(groups.map((g) => [g.name, g.accounts.map((a) => a.id), g.total]), [
        ["投資", [2, 4], 80],
        ["日常", [3], 30],
        [null, [1], 5],
    ])
})

test("既存グループ名は重複なしの出現順", () => {
    assert.deepEqual(existingGroupNames([acc(1, "B", 0), acc(2, null, 0), acc(3, "A", 0), acc(4, "B", 0)]), ["B", "A"])
})

test("並び替えの結果は、グループ順→グループ内順に並び、非表示の口座は所属グループの末尾へ置く", () => {
    const ids = flattenAccountSections(
        [
            { name: "日常", ids: [3] },
            { name: "投資", ids: [4, 2] },
            { name: null, ids: [1] },
        ],
        [
            { id: 10, groupName: "投資" },
            { id: 11, groupName: null },
            { id: 12, groupName: "休眠" },
        ]
    )
    assert.deepEqual(ids, [3, 4, 2, 10, 1, 11, 12])
})
