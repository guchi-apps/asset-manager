"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  FIXED_FIELD_LABELS,
  buildFormValues,
  normalizeLabel,
  suggestDestination,
  summarizeAssignments,
} from "@/lib/payroll/payslip-pdf";
import type {
  AssignmentMemory,
  AssignmentSource,
  DestinationKey,
  FixedField,
  ParsedPayslip,
  PayslipFormValues,
  PayslipLine,
} from "@/lib/payroll/payslip-pdf";
import type { EditableItemDTO, ItemType } from "@/lib/payroll/types";

// 手で選んだ割り当ての記憶。給与明細の項目名はこの端末の利用者に固有なので、端末ごとに持つ
const MEMORY_STORAGE_KEY = "asset-manager:payslip-pdf-assignments";

function loadMemory(): AssignmentMemory {
  try {
    const raw = window.localStorage.getItem(MEMORY_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as AssignmentMemory) : {};
  } catch {
    return {};
  }
}

function saveMemory(memory: AssignmentMemory) {
  try {
    window.localStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(memory));
  } catch {
    // 保存できない環境（プライベートブラウズ等）では記憶しないだけで、反映はできる
  }
}

type RowSource = AssignmentSource | "manual";

const FIELD_GROUPS: { label: string; fields: FixedField[] }[] = [
  { label: "支給", fields: ["baseSalary", "overtimeAmount", "overtimeHours"] },
  {
    label: "法定控除",
    fields: [
      "standardMonthlyRemuneration",
      "healthInsurance",
      "pension",
      "employmentInsurance",
      "incomeTax",
      "residentTax",
    ],
  },
];

const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  earning: "支給の項目",
  otherEarning: "その他支給の項目",
  otherTaxable: "その他(課税処理)の項目",
  statutoryDeduction: "法定控除の項目",
  deduction: "控除の項目",
};

function formatAmount(line: PayslipLine, destination: DestinationKey) {
  if (destination === "field:overtimeHours") return `${line.amount.toLocaleString()} h`;
  return `${line.amount.toLocaleString()} 円`;
}

function StatusChip({ line, source }: { line: PayslipLine; source: RowSource }) {
  const [text, tone] =
    line.kind === "grossTotal" || line.kind === "netTotal"
      ? ["照合用", "mute"]
      : line.kind === "subtotal"
        ? ["小計", "mute"]
        : line.kind === "skip"
          ? ["反映しない", "mute"]
          : source === "auto"
            ? ["自動", "ok"]
            : source === "memory"
              ? ["記憶済み", "ok"]
              : source === "manual"
                ? ["手動", "ok"]
                : ["要確認", "warn"];
  return (
    <span
      className={cn(
        "inline-block rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
        tone === "ok" && "bg-primary/10 text-primary",
        tone === "warn" && "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
        tone === "mute" && "border text-muted-foreground"
      )}
    >
      {text}
    </span>
  );
}

export function PayslipPdfImport({
  items,
  payday,
  onApply,
}: {
  items: EditableItemDTO[];
  /** 支給日の「日」。PDFには年月しか無いため、前回の支給日の日付を使う */
  payday: number;
  onApply: (values: PayslipFormValues) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [needsPassword, setNeedsPassword] = useState(false);
  const [isReading, setIsReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedPayslip | null>(null);
  const [destinations, setDestinations] = useState<DestinationKey[]>([]);
  const [sources, setSources] = useState<RowSource[]>([]);

  async function read(target: File, pdfPassword: string) {
    setIsReading(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", target);
      if (pdfPassword) body.append("password", pdfPassword);
      const res = await fetch("/api/salaries/import-pdf", { method: "POST", body });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setParsed(null);
        setNeedsPassword(Boolean(json?.needsPassword));
        setError(json?.error ?? "PDFを読み取れませんでした");
        return;
      }
      const result = json as ParsedPayslip;
      const memory = loadMemory();
      const suggestions = result.lines.map((line) =>
        line.kind === "value"
          ? suggestDestination(line.label, items, memory)
          : { destination: "none" as const, source: "none" as const }
      );
      setNeedsPassword(false);
      setParsed(result);
      setDestinations(suggestions.map((s) => s.destination));
      setSources(suggestions.map((s) => s.source));
    } catch {
      setError("PDFを送信できませんでした。通信状況を確かめてもう一度選んでください");
    } finally {
      setIsReading(false);
    }
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    event.target.value = "";
    if (!selected) return;
    setFile(selected);
    setPassword("");
    void read(selected, "");
  }

  function handleDestinationChange(index: number, value: DestinationKey) {
    setDestinations((prev) => prev.map((d, i) => (i === index ? value : d)));
    setSources((prev) => prev.map((s, i) => (i === index ? "manual" : s)));
  }

  function reset() {
    setFile(null);
    setParsed(null);
    setError(null);
    setNeedsPassword(false);
    setPassword("");
  }

  function apply() {
    if (!parsed) return;
    const memory = loadMemory();
    parsed.lines.forEach((line, index) => {
      if (sources[index] === "manual") memory[normalizeLabel(line.label)] = destinations[index];
    });
    saveMemory(memory);
    onApply(buildFormValues(parsed, destinations, items, payday));
    toast.success("PDFの内容をフォームに反映しました。確かめてから登録してください");
  }

  const summary = parsed ? summarizeAssignments(parsed.lines, destinations, items) : null;
  const grossTotal = parsed?.lines.find((line) => line.kind === "grossTotal")?.amount;
  const netTotal = parsed?.lines.find((line) => line.kind === "netTotal")?.amount;
  const valueRows = parsed ? parsed.lines.map((line, i) => ({ line, source: sources[i] })) : [];
  const count = (source: RowSource) =>
    valueRows.filter((row) => row.line.kind === "value" && row.source === source).length;
  const payDate = parsed ? buildFormValues(parsed, [], [], payday).salaryDate : undefined;

  const itemGroups = (Object.keys(ITEM_TYPE_LABELS) as ItemType[])
    .map((type) => ({ type, items: items.filter((item) => item.itemType === type) }))
    .filter((group) => group.items.length > 0);

  function destinationSelect(index: number, className?: string) {
    const line = parsed!.lines[index];
    if (line.kind === "grossTotal" || line.kind === "netTotal") {
      return <span className="text-xs text-muted-foreground">照合に使う</span>;
    }
    if (line.kind !== "value") return <span className="text-xs text-muted-foreground">—</span>;
    return (
      <Select
        value={destinations[index]}
        onValueChange={(value) => handleDestinationChange(index, value as DestinationKey)}
      >
        <SelectTrigger
          size="sm"
          aria-label={`${line.label}の反映先`}
          className={cn("min-w-44", destinations[index] === "none" && "text-muted-foreground", className)}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">反映しない</SelectItem>
          {FIELD_GROUPS.map((group) => (
            <SelectGroup key={group.label}>
              <SelectSeparator />
              <SelectLabel>{group.label}</SelectLabel>
              {group.fields.map((field) => (
                <SelectItem key={field} value={`field:${field}`}>
                  {FIXED_FIELD_LABELS[field]}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
          {itemGroups.map((group) => (
            <SelectGroup key={group.type}>
              <SelectSeparator />
              <SelectLabel>{ITEM_TYPE_LABELS[group.type]}</SelectLabel>
              {group.items.map((item) => (
                <SelectItem key={item.id} value={`item:${item.id}`}>
                  {item.itemName}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    );
  }

  const checks = summary && (
    <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
      <CheckBox title="支給額" pdfLabel="PDF 総支給額" pdfValue={grossTotal} actual={summary.gross} />
      <CheckBox title="手取額" pdfLabel="PDF 差引支給額" pdfValue={netTotal} actual={summary.net} />
    </div>
  );

  const actions = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <p className="min-w-full flex-1 text-xs text-muted-foreground sm:min-w-52">
        反映しても保存はされません。内容を確かめてから「登録する」を押してください。
      </p>
      <Button type="button" variant="outline" onClick={reset} className="flex-1 sm:flex-none">
        取り消す
      </Button>
      <Button type="button" onClick={apply} className="flex-1 sm:flex-none">
        フォームに反映
      </Button>
    </div>
  );

  return (
    <div className={cn("gap-4", parsed ? "grid lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-start" : "flex")}>
      <div className="flex w-full flex-col gap-3 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-medium">PDFから読み取る</p>
            <p className="text-xs text-muted-foreground">
              給与明細のPDFから金額を読み取り、下のフォームに入れます。PDFはサーバーに保存しません。
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant={file ? "outline" : "default"}
            disabled={isReading}
            onClick={() => fileInputRef.current?.click()}
          >
            {file ? "別のPDFを選ぶ" : "PDFを選ぶ"}
          </Button>
          <input
            ref={fileInputRef}
            id="payslip-pdf"
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>

        {file && (
          <div className="flex items-center gap-2.5 rounded-lg border border-dashed bg-background px-3 py-2.5 text-sm">
            <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-bold text-destructive">
              PDF
            </span>
            <span className="min-w-0 flex-1 truncate">{file.name}</span>
            {isReading ? (
              <span className="text-xs text-muted-foreground">読み取り中…</span>
            ) : parsed ? (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                読み取り完了
              </span>
            ) : null}
          </div>
        )}

        {error && (
          <p className="text-sm text-destructive">
            {error}
            <span className="block text-xs text-muted-foreground">
              明細は保存されていません。登録済みの明細も変わっていません。
            </span>
          </p>
        )}

        {needsPassword && file && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void read(file, password);
            }}
          >
            <div className="flex min-w-48 flex-1 flex-col gap-1.5">
              <Label htmlFor="payslip-pdf-password">PDFのパスワード</Label>
              <Input
                id="payslip-pdf-password"
                type="password"
                autoComplete="off"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            <Button type="submit" disabled={isReading || password === ""}>
              読み取る
            </Button>
          </form>
        )}

        {parsed && (
          <>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <span>
                <span className="mr-1.5 text-muted-foreground">支給日</span>
                {payDate ? payDate.replaceAll("-", "/") : "読み取れませんでした（今の値のまま）"}
              </span>
              <span>
                <span className="mr-1.5 text-muted-foreground">自動</span>
                {count("auto")}件
              </span>
              {count("memory") > 0 && (
                <span>
                  <span className="mr-1.5 text-muted-foreground">記憶済み</span>
                  {count("memory")}件
                </span>
              )}
              {count("none") > 0 && (
                <span>
                  <span className="mr-1.5 text-muted-foreground">要確認</span>
                  {count("none")}件
                </span>
              )}
            </div>

            {/* PC・タブレット: 表 */}
            <table className="hidden w-full border-collapse text-sm tabular-nums md:table">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-2 py-1.5 font-medium">PDFの項目</th>
                  <th className="px-2 py-1.5 text-right font-medium">金額</th>
                  <th className="px-2 py-1.5 font-medium">反映先</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {parsed.lines.map((line, index) => (
                  <tr
                    key={index}
                    className={cn("border-b", line.kind !== "value" && "text-muted-foreground")}
                  >
                    <td className="px-2 py-1.5">{line.label}</td>
                    <td className="px-2 py-1.5 text-right whitespace-nowrap">
                      {formatAmount(line, destinations[index])}
                    </td>
                    <td className="px-2 py-1.5">{destinationSelect(index)}</td>
                    <td className="px-2 py-1.5">
                      <StatusChip line={line} source={sources[index]} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* スマホ: 1行ずつのカード */}
            <div className="md:hidden">
              {parsed.lines.map((line, index) => (
                <div
                  key={index}
                  className={cn(
                    "flex flex-col gap-1.5 border-b py-2.5",
                    line.kind !== "value" && "text-muted-foreground"
                  )}
                >
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="font-medium">{line.label}</span>
                    <span className="font-medium tabular-nums whitespace-nowrap">
                      {formatAmount(line, destinations[index])}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">{destinationSelect(index, "w-full min-w-0")}</div>
                    <StatusChip line={line} source={sources[index]} />
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-3 lg:hidden">
              {checks}
              {actions}
            </div>
          </>
        )}
      </div>

      {parsed && (
        <div className="sticky top-0 hidden flex-col gap-3 rounded-xl border bg-card p-4 lg:flex">
          <p className="font-medium">合計の照合</p>
          {checks}
          {actions}
        </div>
      )}
    </div>
  );
}

function CheckBox({
  title,
  pdfLabel,
  pdfValue,
  actual,
}: {
  title: string;
  pdfLabel: string;
  pdfValue: number | undefined;
  actual: number;
}) {
  const diff = pdfValue === undefined ? 0 : actual - pdfValue;
  const matched = pdfValue !== undefined && diff === 0;
  return (
    <div
      className={cn(
        "flex flex-col gap-0.5 rounded-lg border px-3 py-2.5 tabular-nums",
        pdfValue !== undefined &&
          !matched &&
          "border-amber-500 bg-amber-50 dark:border-amber-400/60 dark:bg-amber-950/30"
      )}
    >
      <span className="text-xs text-muted-foreground">{title}</span>
      <div className="flex justify-between text-sm">
        <span>{pdfLabel}</span>
        <span>{pdfValue === undefined ? "—" : `${pdfValue.toLocaleString()} 円`}</span>
      </div>
      <div className="flex justify-between text-sm">
        <span>反映後</span>
        <span>{actual.toLocaleString()} 円</span>
      </div>
      <span
        className={cn(
          "text-xs font-medium",
          matched ? "text-primary" : "text-amber-700 dark:text-amber-300"
        )}
      >
        {pdfValue === undefined
          ? "PDFに合計が見つからないため照合できません"
          : matched
            ? "一致しています"
            : `${Math.abs(diff).toLocaleString()} 円${diff > 0 ? "多く" : "少なく"}なっています（反映先を確かめてください）`}
      </span>
    </div>
  );
}
