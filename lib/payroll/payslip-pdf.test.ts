// 給与明細PDFの取り込み（payslip-pdf.ts）の単体テスト。
// 見本の明細は payslip-pdf.fixture.ts（架空の金額）。
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildFormValues,
  parseAmount,
  parsePayslipText,
  suggestDestination,
  summarizeAssignments,
} from "./payslip-pdf";
import type { DestinationKey } from "./payslip-pdf";
import { items, sample } from "./payslip-pdf.fixture";

describe("parseAmount", () => {
  it("カンマ区切り・小数・全角・マイナス記号を読む", () => {
    assert.equal(parseAmount("330,000"), 330000);
    assert.equal(parseAmount("  8.54 "), 8.54);
    assert.equal(parseAmount("１，０００"), 1000);
    assert.equal(parseAmount("△1,000"), -1000);
    assert.equal(parseAmount("540"), 540);
  });
  it("社員番号のような区切り無しの長い数字・文字列は金額にしない", () => {
    assert.equal(parseAmount("4093001"), undefined);
    assert.equal(parseAmount("本給"), undefined);
    assert.equal(parseAmount("2026年"), undefined);
  });
});

describe("parsePayslipText", () => {
  const parsed = parsePayslipText(sample);
  const byLabel = (label: string) => parsed.lines.find((line) => line.label === label);

  it("年月を読む", () => {
    assert.equal(parsed.year, 2026);
    assert.equal(parsed.month, 9);
  });

  it("同じ高さの項目名と金額を組にする", () => {
    assert.deepEqual(byLabel("本給"), { label: "本給", amount: 300000, kind: "value" });
    assert.deepEqual(byLabel("健康保険"), { label: "健康保険", amount: 17300, kind: "value" });
    assert.deepEqual(byLabel("出張旅費(時間外拘束)"), {
      label: "出張旅費(時間外拘束)",
      amount: 2800,
      kind: "value",
    });
    assert.equal(byLabel("超勤時間")?.amount, 8.5);
  });

  it("標報の表記から標準報酬月額を読む", () => {
    assert.deepEqual(byLabel("標準報酬月額（健保440千円）"), {
      label: "標準報酬月額（健保440千円）",
      amount: 440000,
      kind: "value",
    });
  });

  it("合計・小計・内訳・勤務日数・振込先を反映の対象から外す", () => {
    assert.equal(byLabel("総支給額計 (A)")?.kind, "grossTotal");
    assert.equal(byLabel("差引支給額 (A) - (B)")?.kind, "netTotal");
    assert.equal(byLabel("支給額計")?.kind, "subtotal");
    assert.equal(byLabel("控除額合計 (B)")?.kind, "subtotal");
    assert.equal(byLabel("(内子ども子育て支援金)")?.kind, "skip");
    assert.equal(byLabel("出勤")?.kind, "skip");
    assert.equal(byLabel("半日年休(日数換算)")?.kind, "skip");
    assert.equal(byLabel("Vポイント")?.kind, "skip");
  });

  it("社員番号は行にしない", () => {
    assert.equal(
      parsed.lines.some((line) => line.label.startsWith("PIN")),
      false
    );
  });

  it("明細の列ごとに上から並べる", () => {
    const labels = parsed.lines.map((line) => line.label);
    assert.ok(labels.indexOf("本給") < labels.indexOf("総支給額計 (A)"));
    assert.ok(labels.indexOf("超勤時間") < labels.indexOf("本給"));
    assert.ok(labels.indexOf("総支給額計 (A)") < labels.indexOf("健康保険"));
  });
});

describe("suggestDestination", () => {
  it("固定の入力欄へ別名で割り当てる", () => {
    assert.equal(suggestDestination("本給", items).destination, "field:baseSalary");
    assert.equal(suggestDestination("厚年保険", items).destination, "field:pension");
    assert.equal(suggestDestination("超勤時間", items).destination, "field:overtimeHours");
    assert.equal(
      suggestDestination("標準報酬月額（健保440千円）", items).destination,
      "field:standardMonthlyRemuneration"
    );
  });

  it("項目名と一致する項目へ割り当てる（括弧書きは外して比べる）", () => {
    assert.deepEqual(suggestDestination("通勤手当", items), {
      destination: "item:commute",
      source: "auto",
    });
    assert.equal(suggestDestination("出張旅費(時間外拘束)", items).destination, "item:travel");
  });

  it("記憶した割り当てを優先し、消えた項目の記憶は使わない", () => {
    assert.deepEqual(suggestDestination("組合売掛", items, { 組合売掛: "item:union" }), {
      destination: "item:union",
      source: "memory",
    });
    assert.deepEqual(suggestDestination("組合売掛", items, { 組合売掛: "item:deleted" }), {
      destination: "none",
      source: "none",
    });
  });
});

describe("summarizeAssignments / buildFormValues", () => {
  const parsed = parsePayslipText(sample);
  const destinations: DestinationKey[] = parsed.lines.map(
    (line) => suggestDestination(line.label, items).destination
  );

  it("すべて割り当てれば PDF の総支給額・差引支給額と一致する", () => {
    const summary = summarizeAssignments(parsed.lines, destinations, items);
    assert.equal(summary.gross, 369300);
    assert.equal(summary.net, 258560);
  });

  it("割り当てが無い控除は手取額の差として現れる", () => {
    const withoutUnion = destinations.map((key) => (key === "item:union" ? "none" : key));
    assert.equal(summarizeAssignments(parsed.lines, withoutUnion, items).net, 258560 + 7000);
  });

  it("フォームの値に変換する。PDFに無い金額欄は 0、年月と前回の支給日から支給日を作る", () => {
    const values = buildFormValues(parsed, destinations, items, 25);
    assert.equal(values.salaryDate, "2026-09-25");
    assert.equal(values.fields.baseSalary, 300000);
    assert.equal(values.fields.overtimeHours, 8.5);
    assert.equal(values.fields.standardMonthlyRemuneration, 440000);
    assert.equal(values.fields.residentTax, 18000);
    assert.deepEqual(values.customValues, { commute: 45000, travel: 2800, housing: 20000, union: 7000 });
    assert.ok(values.applied.includes("salaryDate"));
    assert.ok(values.applied.includes("baseSalary"));
    assert.ok(values.applied.includes("item:commute"));
    assert.equal(values.applied.includes("overtimeAmount"), true);

    const withoutTax = destinations.map((key) => (key === "field:residentTax" ? "none" : key));
    assert.equal(buildFormValues(parsed, withoutTax, items, 25).fields.residentTax, 0);
  });

  it("支給日はその月の末日を超えない", () => {
    const values = buildFormValues({ year: 2026, month: 2, lines: [] }, [], items, 31);
    assert.equal(values.salaryDate, "2026-02-28");
    assert.equal(values.fields.baseSalary, undefined);
  });
});
