"use client";

import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { GripVertical, Loader2, Pencil, Plus } from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useRouter } from "next/navigation";

import { CreateItemSchema } from "@/lib/payroll/validators";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem as SelectOption,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { createPayItemAction, reorderPayItemsAction, updatePayItemAction } from "@/app/actions/payroll";
import type { ItemDTO, ItemScope, ItemType } from "@/lib/payroll/types";

type ItemFormValues = {
  itemName: string;
  itemType: ItemType;
  scope: ItemScope;
  isTaxable: boolean;
};

const ITEM_TYPE_ORDER: ItemType[] = [
  "earning",
  "otherEarning",
  "otherTaxable",
  "statutoryDeduction",
  "deduction",
];

const ITEM_TYPE_LABEL: Record<ItemType, string> = {
  earning: "支給",
  otherEarning: "その他支給",
  otherTaxable: "その他(課税処理)",
  statutoryDeduction: "法定控除",
  deduction: "控除",
};

const SCOPE_LABEL: Record<ItemScope, string> = {
  salary: "給与",
  bonus: "賞与",
  both: "両方",
};

export function ItemManager({ items: initialItems }: { items: ItemDTO[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ItemDTO | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [isReordering, setIsReordering] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor));

  const {
    register,
    control,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ItemFormValues>({
    resolver: zodResolver(
      CreateItemSchema.pick({ itemName: true, itemType: true, scope: true, isTaxable: true }).required()
    ),
    defaultValues: { itemName: "", itemType: "earning", scope: "both", isTaxable: true },
  });

  const watchedItemType = watch("itemType");
  const isEarningType = watchedItemType === "earning" || watchedItemType === "otherEarning";

  function openCreateDialog() {
    setEditingItem(null);
    reset({ itemName: "", itemType: "earning", scope: "both", isTaxable: true });
    setDialogOpen(true);
  }

  function openEditDialog(item: ItemDTO) {
    setEditingItem(item);
    reset({
      itemName: item.itemName,
      itemType: item.itemType,
      scope: item.scope,
      isTaxable: item.isTaxable,
    });
    setDialogOpen(true);
  }

  async function persistOrder(reordered: ItemDTO[]) {
    setItems(reordered);
    setIsReordering(true);
    try {
      const result = await reorderPayItemsAction(reordered.map((item) => item.id));
      if (!result.success) toast.error(result.error);
      router.refresh();
    } finally {
      setIsReordering(false);
    }
  }

  async function handleDragEndForCategory(category: ItemType, event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const categoryItems = items.filter((i) => i.itemType === category);
    const oldIndex = categoryItems.findIndex((i) => i.id === active.id);
    const newIndex = categoryItems.findIndex((i) => i.id === over.id);
    const reorderedCategory = arrayMove(categoryItems, oldIndex, newIndex);

    const reordered = ITEM_TYPE_ORDER.flatMap((type) =>
      type === category ? reorderedCategory : items.filter((i) => i.itemType === type)
    );

    await persistOrder(reordered);
  }

  async function handleToggleActive(item: ItemDTO) {
    setTogglingId(item.id);
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, isActive: !i.isActive } : i)));
    try {
      // 無効にしても、すでに金額がある明細の金額は残る（編集画面に「（無効）」付きで出る）
      const result = await updatePayItemAction(item.id, { isActive: !item.isActive });
      if (!result.success) {
        toast.error(result.error);
        setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, isActive: item.isActive } : i)));
      }
      router.refresh();
    } finally {
      setTogglingId(null);
    }
  }

  async function onSubmit(values: ItemFormValues) {
    if (editingItem) {
      const result = await updatePayItemAction(editingItem.id, values);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setItems((prev) => prev.map((i) => (i.id === editingItem.id ? { ...i, ...values } : i)));
      toast.success("項目を更新しました");
    } else {
      const result = await createPayItemAction(values);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      const now = new Date().toISOString();
      setItems((prev) => [
        ...prev,
        {
          ...values,
          id: result.data.id,
          userId: "",
          displayOrder: prev.length,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        },
      ]);
      toast.success("項目を追加しました");
    }
    reset();
    setEditingItem(null);
    setDialogOpen(false);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) setEditingItem(null);
          }}
        >
          <DialogTrigger asChild>
            <Button onClick={openCreateDialog}>
              <Plus className="size-4" />
              項目を追加
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingItem ? "項目を編集" : "項目を追加"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="itemName">項目名</Label>
                <Input id="itemName" {...register("itemName")} />
                {errors.itemName && <p className="text-sm text-destructive">{errors.itemName.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="itemType">種別</Label>
                <Controller
                  control={control}
                  name="itemType"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="itemType" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ITEM_TYPE_ORDER.map((type) => (
                          <SelectOption key={type} value={type}>
                            {ITEM_TYPE_LABEL[type]}
                          </SelectOption>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
              <div className="space-y-1.5">
                <Label>適用範囲</Label>
                <Controller
                  control={control}
                  name="scope"
                  render={({ field }) => {
                    const salarySelected = field.value !== "bonus";
                    const bonusSelected = field.value !== "salary";

                    function toggle(target: "salary" | "bonus") {
                      const nextSalary = target === "salary" ? !salarySelected : salarySelected;
                      const nextBonus = target === "bonus" ? !bonusSelected : bonusSelected;
                      if (!nextSalary && !nextBonus) return;
                      const nextScope: ItemScope =
                        nextSalary && nextBonus ? "both" : nextSalary ? "salary" : "bonus";
                      field.onChange(nextScope);
                    }

                    return (
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant={salarySelected ? "default" : "outline"}
                          onClick={() => toggle("salary")}
                        >
                          給与
                        </Button>
                        <Button
                          type="button"
                          variant={bonusSelected ? "default" : "outline"}
                          onClick={() => toggle("bonus")}
                        >
                          賞与
                        </Button>
                      </div>
                    );
                  }}
                />
              </div>
              {isEarningType && (
                <div className="flex items-center justify-between">
                  <Label htmlFor="isTaxable">課税対象</Label>
                  <Controller
                    control={control}
                    name="isTaxable"
                    render={({ field }) => (
                      <Switch
                        id="isTaxable"
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    )}
                  />
                </div>
              )}
              {editingItem && (
                <p className="text-xs text-muted-foreground">
                  項目名・種別・課税対象を変更しても、すでに保存した給与・賞与の明細は保存時点の内容のまま集計されます。
                  変更は今後保存する明細から使われます。
                </p>
              )}
              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="size-4 animate-spin" />}
                {editingItem ? "更新する" : "追加する"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-6">
        {ITEM_TYPE_ORDER.map((category) => {
          const categoryItems = items.filter((i) => i.itemType === category);
          if (categoryItems.length === 0) return null;

          return (
            <div key={category} className="space-y-2">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
                {ITEM_TYPE_LABEL[category]}
                {isReordering && <Loader2 className="size-3.5 animate-spin" />}
              </h2>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={(event) => handleDragEndForCategory(category, event)}
              >
                <SortableContext
                  items={categoryItems.map((i) => i.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-2">
                    {categoryItems.map((item) => (
                      <SortableItemRow
                        key={item.id}
                        item={item}
                        onToggleActive={handleToggleActive}
                        onEdit={openEditDialog}
                        isToggling={togglingId === item.id}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SortableItemRow({
  item,
  onToggleActive,
  onEdit,
  isToggling,
}: {
  item: ItemDTO;
  onToggleActive: (item: ItemDTO) => void;
  onEdit: (item: ItemDTO) => void;
  isToggling: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: item.id });

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}>
      <Card>
      <CardContent className="flex items-center gap-3">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="cursor-grab text-muted-foreground"
          aria-label="並び替え"
        >
          <GripVertical className="size-4" />
        </button>
        <div className="flex-1">
          <p className="font-medium">{item.itemName}</p>
        </div>
        <Badge variant="secondary">{SCOPE_LABEL[item.scope]}</Badge>
        {(item.itemType === "earning" || item.itemType === "otherEarning") && !item.isTaxable && (
          <Badge variant="outline">非課税</Badge>
        )}
        <button
          type="button"
          onClick={() => onEdit(item)}
          className="text-muted-foreground hover:text-foreground"
          aria-label="編集"
        >
          <Pencil className="size-4" />
        </button>
        {isToggling ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        ) : (
          <Switch checked={item.isActive} onCheckedChange={() => onToggleActive(item)} />
        )}
      </CardContent>
      </Card>
    </div>
  );
}
