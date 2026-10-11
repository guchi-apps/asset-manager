// 給与明細PDFの取り込み（#256）。
//
// PDFから取り出した「文字列と座標」の並びを、明細の「項目名と金額」の行に組み立て、
// 給与フォームの入力欄・登録済みの項目へ割り当てる。
//
// 想定している明細は、項目名の列と金額の列が同じ高さ（y座標）で左右に並ぶ表。
// 行の区切りは PDF 上に文字として無いため、同じ高さにある文字列を1行とみなし、
// 金額の直前（左）にある文字列をその金額の項目名とする。
//
// サーバー（抽出）とクライアント（割り当て）の両方から使うため、この lib は `db` に依存させない。
// `node --test` で単体テストするため、import は相対パス・拡張子付きで書く。
import type { ItemDTO } from "./types";

/** pdf.js の getTextContent() の1要素から必要な値だけを抜き出したもの */
export type PdfTextItem = { str: string; x: number; y: number };

export type PayslipLineKind =
  /** 入力欄・項目へ割り当てる金額 */
  | "value"
  /** 総支給額（照合に使う） */
  | "grossTotal"
  /** 差引支給額（照合に使う） */
  | "netTotal"
  /** 支給額計・控除額合計などの小計。反映しない */
  | "subtotal"
  /** 内訳・勤務日数・振込先など。反映しない */
  | "skip";

export type PayslipLine = {
  label: string;
  amount: number;
  kind: PayslipLineKind;
};

export type ParsedPayslip = {
  /** 明細の年月。読み取れなければ undefined */
  year?: number;
  month?: number;
  lines: PayslipLine[];
};

// 同じ行とみなす y 座標の差（pt）。見本の明細では項目名と金額の y が 0〜2pt ずれる
const LINE_TOLERANCE = 3;

/** 全角英数・半角カナを揃え、空白を取り除く */
export function normalizeLabel(label: string): string {
  return label.normalize("NFKC").replace(/\s+/g, "");
}

/** 「出張旅費(時間外拘束)」の括弧書きを外した名前 */
function stripParenthetical(label: string): string {
  return label.replace(/\([^)]*\)$/, "");
}

/** 金額・時間として読める文字列なら数値を返す。社員番号のような桁の多い区切り無しの数字は除く */
export function parseAmount(text: string): number | undefined {
  const value = text.normalize("NFKC").trim();
  const match = value.match(/^([-△▲])?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?$/);
  if (!match) return undefined;
  const [, sign, integer, decimal] = match;
  if (!integer.includes(",") && !decimal && integer.length > 4) return undefined;
  const amount = Number(integer.replace(/,/g, "") + (decimal ?? ""));
  return sign ? -amount : amount;
}

// (A)・(B)・(A)-(B) のような記号だけの文字列。直前の項目名と組み合わせて使う
const MARKER = /^\([A-Z]\)(-\([A-Z]\))?$/;
const GROSS_TOTAL = /総支給|支給総額|支給合計/;
const NET_TOTAL = /差引支給|差引額|手取|^\(A\)-\(B\)$/;
const SUBTOTAL = /計$|合計|小計|^\([A-Z]\)$/;
const BREAKDOWN = /^\(内/;
const ATTENDANCE = /出勤|欠勤|年休|有休|休暇|日数|遅刻|早退/;

function classify(label: string): PayslipLineKind {
  const normalized = normalizeLabel(label);
  if (GROSS_TOTAL.test(normalized)) return "grossTotal";
  if (NET_TOTAL.test(normalized)) return "netTotal";
  if (SUBTOTAL.test(stripMarker(normalized))) return "subtotal";
  if (BREAKDOWN.test(normalized)) return "skip";
  if (ATTENDANCE.test(normalized) && !OVERTIME_HOURS.test(normalized)) return "skip";
  return "value";
}

function stripMarker(normalized: string): string {
  const stripped = normalized.replace(/\([A-Z]\)(-\([A-Z]\))?$/, "");
  return stripped || normalized;
}

type Token = PdfTextItem & { amount?: number };

function groupLines(items: PdfTextItem[]): Token[][] {
  const tokens: Token[] = items
    .map((item) => ({ ...item, str: item.str.trim() }))
    .filter((item) => item.str !== "")
    .map((item) => ({ ...item, amount: parseAmount(item.str) }))
    .sort((a, b) => b.y - a.y);

  const lines: { y: number; tokens: Token[] }[] = [];
  for (const token of tokens) {
    const line = lines.find((l) => Math.abs(l.y - token.y) <= LINE_TOLERANCE);
    if (line) line.tokens.push(token);
    else lines.push({ y: token.y, tokens: [token] });
  }
  return lines.map((line) => line.tokens.sort((a, b) => a.x - b.x));
}

// 「標報 健保４７０千円」のような標準報酬月額の表記
const STANDARD_REMUNERATION = /健保(\d[\d,]*)千円/;
const YEAR_MONTH = /(\d{4})年(\d{1,2})月/;
const REIWA_YEAR_MONTH = /令和(\d{1,2}|元)年(\d{1,2})月/;

type PositionedLine = PayslipLine & { x: number; y: number };

/** 1ページ分の文字列から明細の行と年月を読み取る */
export function parsePayslipText(items: PdfTextItem[]): ParsedPayslip {
  const lines: PositionedLine[] = [];
  let year: number | undefined;
  let month: number | undefined;

  for (const tokens of groupLines(items)) {
    const text = normalizeLabel(tokens.map((t) => t.str).join(""));
    if (year === undefined) {
      const western = text.match(YEAR_MONTH);
      const reiwa = text.match(REIWA_YEAR_MONTH);
      if (western) {
        year = Number(western[1]);
        month = Number(western[2]);
      } else if (reiwa) {
        year = 2018 + (reiwa[1] === "元" ? 1 : Number(reiwa[1]));
        month = Number(reiwa[2]);
      }
    }

    tokens.forEach((token, index) => {
      if (token.amount === undefined) {
        const standard = normalizeLabel(token.str).match(STANDARD_REMUNERATION);
        if (standard) {
          lines.push({
            label: `標準報酬月額（${token.str.normalize("NFKC").trim()}）`,
            amount: Number(standard[1].replace(/,/g, "")) * 1000,
            kind: "value",
            x: token.x,
            y: token.y,
          });
        }
        return;
      }
      const labelToken = tokens[index - 1];
      if (!labelToken || labelToken.amount !== undefined) return;
      let label = labelToken.str.normalize("NFKC");
      const beforeLabel = tokens[index - 2];
      if (MARKER.test(normalizeLabel(label)) && beforeLabel && beforeLabel.amount === undefined) {
        label = `${beforeLabel.str.normalize("NFKC")} ${label}`;
      }
      const kind = classify(label);
      // 「(A) - (B)」だけでは何の金額か分からないため、名前を補う
      if (kind === "netTotal" && MARKER.test(normalizeLabel(label))) label = `差引支給額 ${label}`;
      lines.push({ label, amount: token.amount, kind, x: labelToken.x, y: token.y });
    });
  }

  // 差引支給額と同じ金額の行（振込先の口座ごとの内訳など）は反映しない
  const net = lines.find((line) => line.kind === "netTotal");
  if (net) {
    for (const line of lines) {
      if (line.kind === "value" && line.amount === net.amount) line.kind = "skip";
    }
  }

  // 明細の列（左から）→ 上から、の順に並べる。列は項目名の x 座標を 100pt 単位で区切る
  lines.sort((a, b) => Math.floor(a.x / 100) - Math.floor(b.x / 100) || b.y - a.y);
  return { year, month, lines: lines.map(({ label, amount, kind }) => ({ label, amount, kind })) };
}

// --- 割り当て ---

export const FIXED_FIELDS = [
  "baseSalary",
  "overtimeAmount",
  "overtimeHours",
  "standardMonthlyRemuneration",
  "healthInsurance",
  "pension",
  "employmentInsurance",
  "incomeTax",
  "residentTax",
] as const;
export type FixedField = (typeof FIXED_FIELDS)[number];

export const FIXED_FIELD_LABELS: Record<FixedField, string> = {
  baseSalary: "基本給",
  overtimeAmount: "超勤手当",
  overtimeHours: "残業時間(h)",
  standardMonthlyRemuneration: "標準報酬月額",
  healthInsurance: "健康保険料",
  pension: "厚生年金保険料",
  employmentInsurance: "雇用保険料",
  incomeTax: "所得税",
  residentTax: "住民税",
};

const OVERTIME_HOURS = /^(超勤|時間外|時間外勤務|残業|超過勤務|時間外労働)時間$/;

const FIXED_FIELD_ALIASES: [FixedField, RegExp][] = [
  ["baseSalary", /^(本給|基本給|基本賃金)$/],
  ["overtimeAmount", /^(超勤|時間外|時間外勤務|残業|超過勤務|時間外労働)手当$/],
  ["overtimeHours", OVERTIME_HOURS],
  ["standardMonthlyRemuneration", /^標準報酬月額/],
  ["healthInsurance", /^(健康保険料?|健保料?)$/],
  ["pension", /^(厚生年金(保険)?料?|厚年(保険)?料?)$/],
  ["employmentInsurance", /^雇用保険料?$/],
  ["incomeTax", /^(源泉)?所得税$|^源泉税$/],
  ["residentTax", /^(住民税|市県民税|市民税|区民税|都民税)$/],
];

/** 割り当て先を1つの文字列で表す。"field:baseSalary" / "item:<id>" / "none" */
export type DestinationKey = `field:${FixedField}` | `item:${string}` | "none";

export type AssignmentSource = "auto" | "memory" | "none";

/** 手で選んだ割り当ての記憶。キーは normalizeLabel() 済みの項目名 */
export type AssignmentMemory = Record<string, DestinationKey>;

function isValidDestination(key: DestinationKey, items: Pick<ItemDTO, "id">[]): boolean {
  if (key === "none") return true;
  if (key.startsWith("field:")) return FIXED_FIELDS.includes(key.slice(6) as FixedField);
  return items.some((item) => item.id === key.slice(5));
}

/** 項目名から割り当て先を推定する。記憶 → 固定の入力欄 → 項目管理の項目名 の順 */
export function suggestDestination(
  label: string,
  items: Pick<ItemDTO, "id" | "itemName">[],
  memory: AssignmentMemory = {}
): { destination: DestinationKey; source: AssignmentSource } {
  const normalized = normalizeLabel(label);
  const remembered = memory[normalized];
  if (remembered && isValidDestination(remembered, items)) {
    return { destination: remembered, source: "memory" };
  }

  for (const [field, alias] of FIXED_FIELD_ALIASES) {
    if (alias.test(normalized)) return { destination: `field:${field}`, source: "auto" };
  }

  const stripped = stripParenthetical(normalized);
  const item =
    items.find((i) => normalizeLabel(i.itemName) === normalized) ??
    items.find((i) => stripParenthetical(normalizeLabel(i.itemName)) === stripped);
  if (item) return { destination: `item:${item.id}`, source: "auto" };

  return { destination: "none", source: "none" };
}

const EARNING_FIELDS: FixedField[] = ["baseSalary", "overtimeAmount"];
const DEDUCTION_FIELDS: FixedField[] = [
  "healthInsurance",
  "pension",
  "employmentInsurance",
  "incomeTax",
  "residentTax",
];

function destinationEffect(
  key: DestinationKey,
  items: Pick<ItemDTO, "id" | "itemType">[]
): "earning" | "deduction" | "none" {
  if (key === "none") return "none";
  if (key.startsWith("field:")) {
    const field = key.slice(6) as FixedField;
    if (EARNING_FIELDS.includes(field)) return "earning";
    if (DEDUCTION_FIELDS.includes(field)) return "deduction";
    return "none";
  }
  const item = items.find((i) => i.id === key.slice(5));
  if (!item) return "none";
  if (item.itemType === "earning" || item.itemType === "otherEarning") return "earning";
  if (item.itemType === "statutoryDeduction" || item.itemType === "deduction") return "deduction";
  return "none";
}

/** 割り当てどおりに反映したときの支給額・手取額（SalaryForm の計算と同じ足し引き） */
export function summarizeAssignments(
  lines: PayslipLine[],
  destinations: DestinationKey[],
  items: Pick<ItemDTO, "id" | "itemType">[]
): { gross: number; net: number } {
  let gross = 0;
  let deduction = 0;
  lines.forEach((line, index) => {
    if (line.kind !== "value") return;
    const effect = destinationEffect(destinations[index] ?? "none", items);
    if (effect === "earning") gross += line.amount;
    if (effect === "deduction") deduction += line.amount;
  });
  return { gross, net: gross - deduction };
}

export type PayslipFormValues = {
  /** yyyy-MM-dd。明細の年月が読めなければ undefined */
  salaryDate?: string;
  /** フォームへ入れる値。undefined の欄は今の値のまま */
  fields: Partial<Record<FixedField, number>>;
  /** 全項目の金額。割り当てが無い項目は 0 にする（前回の明細から引き継いだ値を残さない） */
  customValues: Record<string, number>;
  /** PDFの値が入った欄。フォームの欄名（"salaryDate" / FixedField）と "item:<id>" */
  applied: string[];
};

/**
 * 割り当てをフォームの値に変換する。
 *
 * 給与の新規登録フォームは前回の明細の金額を初期値に持ち、空欄の保険料・税は自動計算する。
 * PDFに無い欄をそのまま残すと PDF と違う手取額で保存されるため、金額欄は割り当てが無ければ 0 にする。
 * 基本給（必須）と標準報酬月額（保険料の自動計算にだけ使う）は、PDFに無ければ今の値を残す。
 */
export function buildFormValues(
  parsed: ParsedPayslip,
  destinations: DestinationKey[],
  items: Pick<ItemDTO, "id">[],
  payday: number
): PayslipFormValues {
  const sums = new Map<DestinationKey, number>();
  parsed.lines.forEach((line, index) => {
    const key = destinations[index] ?? "none";
    if (line.kind !== "value" || key === "none") return;
    sums.set(key, (sums.get(key) ?? 0) + line.amount);
  });

  const fields: Partial<Record<FixedField, number>> = {};
  for (const field of FIXED_FIELDS) {
    const sum = sums.get(`field:${field}`);
    if (sum !== undefined) fields[field] = roundAmount(sum);
    else if (field !== "baseSalary" && field !== "standardMonthlyRemuneration") fields[field] = 0;
  }

  const customValues = Object.fromEntries(
    items.map((item) => [item.id, roundAmount(sums.get(`item:${item.id}`) ?? 0)])
  );

  let salaryDate: string | undefined;
  if (parsed.year && parsed.month) {
    const lastDay = new Date(parsed.year, parsed.month, 0).getDate();
    const day = Math.min(Math.max(payday, 1), lastDay);
    salaryDate = `${parsed.year}-${String(parsed.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  const applied = [
    ...(salaryDate ? ["salaryDate"] : []),
    ...[...sums.keys()].map((key) => (key.startsWith("field:") ? key.slice(6) : key)),
  ];
  return { salaryDate, fields, customValues, applied };
}

// 小数の足し算の誤差（0.1 + 0.2 など）を残さない
function roundAmount(value: number): number {
  return Math.round(value * 100) / 100;
}
