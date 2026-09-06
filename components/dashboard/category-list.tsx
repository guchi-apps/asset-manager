"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { AlertCircle, GripVertical, Check, X, ArrowDownUp, Eye, EyeOff, RefreshCw } from "lucide-react"
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip"
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    rectSortingStrategy,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { reorderCategoriesAction, toggleCategoryVisibility } from "@/app/actions/categories"
import { toast } from "sonner"

import { Category } from "@/types/asset"

// --- Sortable Item Component ---
function SortableCategoryItem({ category, children, isEditing, onToggleVisibility }: { category: Category, children: React.ReactNode, isEditing: boolean, onToggleVisibility?: () => void }) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id: category.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 50 : "auto",
        position: 'relative' as const,
        opacity: !isEditing && category.hidden ? 0 : 1,
        display: !isEditing && category.hidden ? 'none' : 'block'
    };

    return (
        <div ref={setNodeRef} style={style} className={`flex flex-col gap-1 p-2 rounded-lg border bg-card/50 shadow-sm ${isDragging ? 'opacity-50 ring-2 ring-primary' : ''} ${isEditing && category.hidden ? 'opacity-40 grayscale-[0.5]' : ''}`}>
            {isEditing && (
                <div className="absolute right-2 top-2 z-20 flex gap-1">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 hover:bg-muted"
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onToggleVisibility?.();
                        }}
                    >
                        {category.hidden ? <EyeOff className="h-3.5 w-3.5 text-muted-foreground" /> : <Eye className="h-3.5 w-3.5 text-primary" />}
                    </Button>
                    <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing p-1.5 hover:bg-muted rounded">
                        <GripVertical className="h-4 w-4 text-muted-foreground" />
                    </div>
                </div>
            )}
            {children}
        </div>
    );
}

export function CategoryList({ 
    categories: initialCategories = [], 
    onRefresh, 
    isRefreshing = false,
    title
}: { 
    categories?: Category[], 
    onRefresh?: () => void, 
    isRefreshing?: boolean,
    title?: string
}) {
    const [categories, setCategories] = useState(initialCategories)
    const [isEditing, setIsEditing] = useState(false)
    const [isSaving, setIsSaving] = useState(false)

    // Sync with props
    useEffect(() => {
        setCategories(initialCategories)
    }, [initialCategories])

    // Sensors for drag interaction
    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    // Filter top-level categories
    const topLevel = categories.filter(c => !c.parentId)

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;

        if (over && active.id !== over.id) {
            setCategories((items) => {
                const activeItem = items.find(c => c.id === active.id);
                const overItem = items.find(c => c.id === over.id);

                if (!activeItem || !overItem || activeItem.parentId !== overItem.parentId) {
                    return items;
                }

                const oldIndex = items.findIndex(c => c.id === active.id);
                const overIndex = items.findIndex(c => c.id === over.id);

                return arrayMove(items, oldIndex, overIndex);
            });
        }
    };

    const handleToggleVisibility = async (categoryId: number) => {
        const category = categories.find(c => c.id === categoryId);
        if (!category) return;

        const newHidden = !category.hidden;
        // Optimistic update
        setCategories(prev => prev.map(c => c.id === categoryId ? { ...c, hidden: newHidden } : c));

        const result = await toggleCategoryVisibility(categoryId, newHidden);
        if (!result.success) {
            toast.error("表示設定の更新に失敗しました");
            // Rollback
            setCategories(prev => prev.map(c => c.id === categoryId ? { ...c, hidden: !newHidden } : c));
        }
    };

    const handleSaveOrder = async () => {
        setIsSaving(true);
        // Calculate new order values based on current state array
        const updates: { id: number, order: number }[] = [];

        // Recursive function to collect orders for each level
        const collectOrders = (parentId: number | null) => {
            const levelItems = categories.filter(c => c.parentId === parentId);
            levelItems.forEach((cat, index) => {
                updates.push({ id: cat.id, order: index });
                collectOrders(cat.id);
            });
        };

        collectOrders(null);

        const result = await reorderCategoriesAction(updates);
        if (result.success) {
            toast.success("並び順を保存しました");
            setIsEditing(false);
        } else {
            toast.error("保存に失敗しました");
        }
        setIsSaving(false);
    };

    const handleCancel = () => {
        setCategories(initialCategories);
        setIsEditing(false);
    };

    const formatSigned = (value: number, digits?: number) => {
        if (value === 0) return digits !== undefined ? `±${value.toFixed(digits)}` : "±0"
        if (digits !== undefined) return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`
        return `${value > 0 ? "+" : ""}${value.toLocaleString()}`
    }

    const renderCategoryCard = (category: Category, isChild = false) => {
        const valueToUse = (isChild ? category.ownValue : category.currentValue) ?? 0
        const costToUse = (category.isCash ? valueToUse : (isChild ? category.ownCostBasis : category.costBasis)) ?? 0
        const profit = valueToUse - costToUse
        const profitPercent = costToUse > 0 ? (profit / costToUse) * 100 : 0

        const hasActiveValuation = valueToUse > 0
        // 負債は評価額をマイナスで持つため損益を出さない（#344）
        const showProfit = !category.isCash && !category.isLiability && hasActiveValuation;

        const cardContent = (
            <Card className={`overflow-hidden h-full cursor-pointer hover:shadow-md transition-all border-l-0 relative group ${isChild ? 'bg-muted/30' : ''} ${!isChild && isEditing ? 'select-none pointer-events-none' : ''}`}>
                <div className="absolute left-0 top-0 bottom-0 w-1.5 transition-all group-hover:w-2" style={{ backgroundColor: category.color }} />
                <CardHeader className={`flex flex-row items-center justify-between space-y-0 pb-0 pl-3 pr-2 pt-0.5 ${isChild ? 'pt-0' : ''}`}>
                    <CardTitle className={`${isChild ? 'text-[10px]' : 'text-xs'} font-medium flex items-center gap-2 text-muted-foreground/80 truncate`}>
                        <span className="truncate">{category.name}</span>
                        {category.isLiability && (
                            <span className="shrink-0 rounded-full border border-red-500/40 px-1.5 text-[8px] font-semibold leading-[14px] text-red-600 dark:text-red-400">
                                負債
                            </span>
                        )}
                    </CardTitle>
                    {!isChild && category.conflicts && category.conflicts.length > 0 && (
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <AlertCircle className="h-3 w-3 text-destructive animate-pulse" />
                                </TooltipTrigger>
                                <TooltipContent className="bg-destructive text-destructive-foreground border-none">
                                    <p className="font-bold text-xs">タグ重複の警告</p>
                                    <p className="text-[10px]">グループ({category.conflicts.join(", ")})内で重複があります</p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    )}
                </CardHeader>
                <CardContent className={`pl-3 pr-2 ${isChild ? 'pb-0' : 'pb-0.5'} pt-0`}>
                    <div className="flex justify-between gap-1.5">
                        {/* Left: Current Value */}
                        <div className="flex flex-col items-start gap-0.5">
                            <span className={`${isChild ? 'text-sm' : 'text-base'} font-bold tracking-tight leading-none ${valueToUse < 0 ? 'text-red-600 dark:text-red-400' : ''}`}>
                                {valueToUse < 0 ? `−¥${Math.abs(valueToUse).toLocaleString()}` : `¥${valueToUse.toLocaleString()}`}
                            </span>
                            {category.lastUpdated && (
                                <span className="text-[8px] text-muted-foreground font-medium opacity-60">
                                    {(() => {
                                        const d = new Date(category.lastUpdated);
                                        return `${d.getFullYear()}年${String(d.getMonth() + 1).padStart(2, '0')}月${String(d.getDate()).padStart(2, '0')}日`;
                                    })()}
                                </span>
                            )}
                        </div>

                        {/* Right: Profit & Performance Changes */}
                        <div className="flex flex-col items-end gap-0">
                            {/* Total Profit - LARGER */}
                            <span className={`${isChild ? 'text-xs' : 'text-sm'} font-bold whitespace-nowrap leading-tight ${category.isCash ? "text-muted-foreground" : (profit >= 0 ? "text-green-600 dark:text-green-400" : "text-red-500")}`}>
                                {showProfit ? (
                                    <>
                                        {profit >= 0 ? '+' : ''}{profit.toLocaleString()}
                                        <span className="text-[10px] font-normal ml-0.5">円</span>
                                        <span className="text-[10px] ml-0.5 opacity-70 font-normal">
                                            ({profit >= 0 ? '+' : ''}{profitPercent.toFixed(1)}%)
                                        </span>
                                    </>
                                ) : null}
                            </span>

                            {/* Comparisons - SMALLER */}
                            {(showProfit && category.dailyChangeDays !== undefined) && (
                                <div className={`text-[10px] font-medium flex items-baseline gap-1 mt-0.5 ${(category.dailyChange || 0) > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
                                    <div className="w-[38px] shrink-0 text-right">
                                        <span className="opacity-70 text-[8px]">{category.dailyChangeDays || 1}日前比</span>
                                    </div>
                                    <span className="text-[10px] font-bold">{formatSigned(category.dailyChange || 0)}</span>
                                    <span className="text-[8px] opacity-80 font-normal">円</span>
                                    {category.dailyChangeRate !== undefined && (
                                        <span className="text-[8px] opacity-70 ml-0.5">({formatSigned(category.dailyChangeRate, 1)}%)</span>
                                    )}
                                </div>
                            )}

                            {(showProfit && category.monthlyChangeDays !== undefined) && (
                                <div className={`text-[10px] font-medium flex items-baseline gap-1 mt-0 ${(category.monthlyChange || 0) > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
                                    <div className="w-[38px] shrink-0 text-right">
                                        <span className="opacity-70 text-[8px]">{category.monthlyChangeDays || 30}日前比</span>
                                    </div>
                                    <span className="text-[10px] font-bold">{formatSigned(category.monthlyChange || 0)}</span>
                                    <span className="text-[8px] opacity-80 font-normal">円</span>
                                    {category.monthlyChangeRate !== undefined && (
                                        <span className="text-[8px] opacity-70 ml-0.5">({formatSigned(category.monthlyChangeRate, 1)}%)</span>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </CardContent>
            </Card>
        );

        return cardContent;
    }

    if (categories.length === 0) return null

    return (
        <div className="space-y-2">
            {/* Toolbar */}
            <div className="flex items-center justify-between mb-4">
                {title && <h2 className="text-xl font-bold tracking-tight">{title}</h2>}
                <div className="flex justify-end gap-1 text-sm">
                    {!isEditing ? (
                        <>
                            {onRefresh && (
                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onRefresh} title="データを更新">
                                    <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                                </Button>
                            )}
                            <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
                                <ArrowDownUp className="mr-1.5 h-3.5 w-3.5" /> 並び替え
                            </Button>
                        </>
                    ) : (
                        <>
                            <Button variant="ghost" size="sm" onClick={handleCancel} disabled={isSaving}>
                                <X className="mr-1.5 h-3.5 w-3.5" /> キャンセル
                            </Button>
                            <Button variant="default" size="sm" onClick={handleSaveOrder} disabled={isSaving}>
                                <Check className="mr-1.5 h-3.5 w-3.5" /> 保存完了
                            </Button>
                        </>
                    )}
                </div>
            </div>

            <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
            >
                <SortableContext
                    items={topLevel.map(c => c.id)}
                    strategy={rectSortingStrategy}
                    disabled={!isEditing}
                >
                    <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                        {topLevel.map((parent) => {
                            const parentCard = renderCategoryCard(parent);

                            return (
                                <SortableCategoryItem key={parent.id} category={parent} isEditing={isEditing} onToggleVisibility={() => handleToggleVisibility(parent.id)}>
                                    {!isEditing ? (
                                        <Link href={`/assets/${parent.id}`} className="block w-full">
                                            {parentCard}
                                        </Link>
                                    ) : (
                                        <div className="block w-full">
                                            {parentCard}
                                        </div>
                                    )}

                                    {(() => {
                                        const renderChildren = (parentId: number) => {
                                            const children = categories.filter(c => c.parentId === parentId)
                                            if (children.length === 0) return null
                                            return (
                                                <SortableContext
                                                    items={children.map(c => c.id)}
                                                    strategy={verticalListSortingStrategy}
                                                    disabled={!isEditing}
                                                >
                                                    <div className="flex flex-col gap-1 ml-3 pl-2 border-l-2 border-muted border-dashed mt-0.5 pb-0.5">
                                                        {children.map(child => (
                                                            <SortableCategoryItem key={child.id} category={child} isEditing={isEditing} onToggleVisibility={() => handleToggleVisibility(child.id)}>
                                                                {!isEditing ? (
                                                                    <Link href={`/assets/${child.id}`} className="block w-full">
                                                                        {renderCategoryCard(child, true)}
                                                                    </Link>
                                                                ) : (
                                                                    <div className="block w-full">
                                                                        {renderCategoryCard(child, true)}
                                                                    </div>
                                                                )}
                                                                {renderChildren(child.id)}
                                                            </SortableCategoryItem>
                                                        ))}
                                                    </div>
                                                </SortableContext>
                                            )
                                        }
                                        return renderChildren(parent.id)
                                    })()}
                                </SortableCategoryItem>
                            )
                        })}
                    </div>
                </SortableContext>
            </DndContext>
        </div>
    )
}
