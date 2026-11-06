# 金額キーパッド（スマホ専用）

標準の数字キーボードには「-」が無く、スマホでは負の金額を打てないため、金額欄をタップすると
画面下から専用キーパッドを出す（#905）。

## 仕様

- 対象は画面幅 768px 未満のみ（`useIsMobile` と同じ境界）。PC・iPad は従来どおり OS キーボード・物理キーボード
- 対象の入力欄は `components/ui/currency-input.tsx`（`CurrencyInput`）と `components/payroll/amount-input.tsx`（`AmountInput`）
- キー: `0-9`・`00`・`.`・`⌫`・`±`・`完了`。数字を押すたびに 3桁区切りのカンマを入れて表示する
- `±` は `allowNegative`、`.` は `allowDecimal` を指定した欄だけ出る（既定は両方 false）。
  家計簿は `lib/ledger-input.ts` が 1円以上の整数しか受け付けない（符号は種別が持つ）ため、家計簿の欄は対象外
- 負の値はスマホ幅のときだけ橙色で表示する
- 入力ルール（桁数上限・先頭 0・符号・小数点は 1 つ）は `lib/amount-keypad.ts` の純関数に置いてあり、`lib/amount-keypad.test.ts` で検証する

## 実装上の注意

- 欄は `inputMode="none"` にして OS キーボードを出さない。キーパッドのボタンは `pointerdown` / `mousedown` を
  `preventDefault` して欄からフォーカスを奪わない（奪うと OS キーボードが出る）
- キーパッドは body 直下へ portal で描画する。Radix の `Dialog` / `Sheet` の外側操作として閉じられないよう、
  `components/ui/dialog.tsx`・`sheet.tsx` が `ignoreAmountKeypad` で `[data-amount-keypad]` への操作を除外している。
  モーダル時に body へ付く `pointer-events: none` は、キーパッド側の `pointer-events-auto` で打ち消す
- スマホ幅の判定は `matchMedia` を同期で読む（`useIsMobile` は初回描画が false で、初回タップで OS キーボードが出うる）
- 物理キーボードでの入力（`onChange`）は従来どおり動く
- iPad 縦などタッチ端末で幅が 768px 以上のものは対象外
