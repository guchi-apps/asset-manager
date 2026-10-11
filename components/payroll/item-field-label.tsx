import { Label } from "@/components/ui/label";
import type { EditableItemDTO } from "@/lib/payroll/types";

// 項目の金額欄のラベル。編集画面で、無効・適用範囲外・削除済みの項目には理由を添える（#211）
// fromPdf は給与明細PDFから値が入った欄に印を付ける（#256）
export function ItemFieldLabel({ item, fromPdf = false }: { item: EditableItemDTO; fromPdf?: boolean }) {
  return (
    <Label htmlFor={`custom-${item.id}`}>
      {item.itemName}
      <PdfMark show={fromPdf} />
      {item.statusNote && (
        <span className="text-xs font-normal text-muted-foreground">{item.statusNote}</span>
      )}
    </Label>
  );
}

// 給与明細PDFから値が入った欄に付ける印（#256）
export function PdfMark({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span className="rounded border border-primary px-1 text-[10px] leading-4 font-bold text-primary">
      PDF
    </span>
  );
}
