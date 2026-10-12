export function AutoCalcHint({
  manualValue,
  autoValue,
  unit = "円",
}: {
  manualValue: number | undefined;
  autoValue: number;
  unit?: string;
}) {
  if (manualValue === undefined || Number.isNaN(manualValue)) {
    return (
      <p className="text-xs text-muted-foreground">
        自動計算: {autoValue.toLocaleString()} {unit}
      </p>
    );
  }

  const diff = manualValue - autoValue;
  if (diff === 0) {
    return (
      <p className="text-xs text-emerald-600">
        ✓ 自動計算と一致（{autoValue.toLocaleString()} {unit}）
      </p>
    );
  }

  return (
    <p className="text-xs text-amber-600">
      自動計算: {autoValue.toLocaleString()} {unit}（差異 {diff > 0 ? "+" : ""}
      {diff.toLocaleString()} {unit}）
    </p>
  );
}
