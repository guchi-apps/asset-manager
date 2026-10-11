// 給与明細PDFの取り込み（payslip-pdf.ts）の単体テスト。
// 実際の明細PDFはリポジトリに置かない（公開リポジトリのため）。見本の明細と同じ配置
// （項目名の列と金額の列が同じ y 座標で並ぶ・y が数pt ずれる行がある）を、架空の金額で再現している。
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildFormValues,
  parseAmount,
  parsePayslipText,
  suggestDestination,
  summarizeAssignments,
} from "./payslip-pdf";
import type { DestinationKey, PdfTextItem } from "./payslip-pdf";

const t = (str: string, x: number, y: number): PdfTextItem => ({ str, x, y });

const sample: PdfTextItem[] = [
  t("給与明細", 119, 549),
  t("PINﾅﾝﾊﾞｰ：", 323, 534),
  t("1234567", 375, 534),
  t("2026年 9月", 42, 548),
  // 勤務実績
  t("出勤", 50, 505),
  t("    15.00", 225, 505),
  t("半日年休（日数換算）", 50, 486),
  t("0.50", 230, 486),
  t("超勤時間", 50, 477),
  t("8.50", 230, 477),
  // 支給
  t("本給", 311, 505),
  t("300,000", 475, 505),
  t("超勤手当", 311, 496),
  t("21,500", 480, 496),
  t("通勤手当", 311, 486),
  t("45,000", 480, 486),
  t("支給額計", 311, 190),
  t("366,500", 475, 190),
  // 法定控除
  t("健康保険", 572, 505),
  t("17,300", 741, 505),
  t("（内子ども子育て支援金）", 572, 496),
  t("500", 756, 496),
  t("厚年保険", 572, 486),
  t("39,500", 741, 486),
  t("雇用保険", 572, 476),
  t("1,840", 746, 476),
  t("所得税", 572, 466),
  t("7,100", 746, 466),
  t("住民税", 572, 456),
  t("18,000", 741, 456),
  t("法定控除計", 572, 418),
  t("83,740", 741, 418),
  // 控除
  t("社宅使用料", 572, 381),
  t("20,000", 741, 381),
  t("組合費", 572, 362),
  t("7,000", 746, 362),
  // その他支給・標準報酬月額
  t("標報", 48, 161),
  t("健保４４０千円", 78, 161),
  t("厚年４４０千円", 158, 161),
  t("出張旅費（時間外拘束）", 311, 161),
  t("2,800", 485, 161),
  // 合計
  t("控除額合計", 572, 96),
  t("(B)", 697, 96),
  t("110,740", 729, 96),
  t("差引支給額", 572, 66),
  t("(A) - (B)", 629, 58),
  t("258,560", 729, 60),
  t("ﾄﾞｺﾓSMTBﾈﾂ", 570, 47),
  t("Vﾎﾟｲﾝﾄ", 627, 47),
  t("258,560", 736, 47),
  t("総支給額計", 311, 39),
  t("(A)", 436, 39),
  t("369,300", 468, 38),
];

const items = [
  { id: "commute", itemName: "通勤手当", itemType: "earning" as const },
  { id: "travel", itemName: "出張旅費", itemType: "otherEarning" as const },
  { id: "housing", itemName: "社宅使用料", itemType: "deduction" as const },
  { id: "union", itemName: "組合費", itemType: "deduction" as const },
];

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
