"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// 対象年の切替。データのある年と、いま開いている年をチップで並べ、任意の年を追加できる
export function TaxYearPicker({
  years,
  selectedYear,
  lockedYears,
}: {
  years: number[];
  selectedYear: number;
  lockedYears: number[];
}) {
  const router = useRouter();
  const [year, setYear] = useState(() => String(selectedYear - 1));

  function handleAdd() {
    const parsed = Number(year);
    if (!Number.isInteger(parsed) || parsed < 2000 || parsed > 2100) {
      toast.error("2000〜2100の年を入力してください");
      return;
    }
    router.push(`/tax?year=${parsed}`);
  }

  return (
    <div className="space-y-3">
      <nav aria-label="対象年" className="flex flex-wrap gap-2">
        {years.map((y) => (
          <Link
            key={y}
            href={`/tax?year=${y}`}
            aria-current={y === selectedYear ? "page" : undefined}
            className={cn(
              "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-4 text-sm tabular-nums",
              y === selectedYear
                ? "border-primary bg-primary font-semibold text-primary-foreground"
                : "bg-card hover:bg-accent"
            )}
          >
            {y}年
            {lockedYears.includes(y) && <span className="text-[11px]">確定</span>}
          </Link>
        ))}
      </nav>
      <form
        className="flex max-w-xs items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          handleAdd();
        }}
      >
        <label htmlFor="tax-year-add" className="sr-only">
          表示する年
        </label>
        <Input id="tax-year-add" type="number" min={2000} max={2100} value={year} onChange={(e) => setYear(e.target.value)} />
        <Button type="submit" variant="outline">
          年を追加
        </Button>
      </form>
    </div>
  );
}
