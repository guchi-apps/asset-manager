# 取引の時刻（#1369）

家計簿の取引（`LedgerEntry`）は、年月日（`date`）に加えて任意の時刻（`time`）を持てる。

- 形式: `HH`（時だけ）か `HH:mm`。`null` は時刻なし。タイムゾーンは持たず、JSTの壁時計の値として扱う。
  既存の取引・取り込み（Zaim・CSV・レシート・メール・AIDE）は `time` を書かないので `null` のまま
- 入力は `components/ui/date-time-picker.tsx`。年月日と時刻を1つの欄にまとめ、開くとカレンダー、その下の時刻の行から
  時・分のスクロール選択へ切り替わる。スマホ（768px未満）は下からのシート、PC・iPad はポップオーバー
- 検証は `lib/ledger-input.ts` の `parseTimeInput`（不正値は「時刻が正しくありません」）。形の処理は `lib/date-field.ts`
- 並びは `date` 降順 → `time` 降順 → `id` 降順（MySQL・MariaDB とも降順では NULL が最後なので、時刻なしは同日の後ろ）。
  並びを変えたのは取引一覧を決める `lib/ledger-service.ts` の2か所だけで、返金・ルール・レシートなど
  副次的な `date desc` の一覧は時刻を見ない
- `editedFields`（取り込み済みの取引で手直しした項目）には `time` を加えない。同期は `time` を書かないので、
  手入力した時刻が上書きされることがない
- `DateField` を使う他の画面（サブスク・給与など）は日付のみのまま
