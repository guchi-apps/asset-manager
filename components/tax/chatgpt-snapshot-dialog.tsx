"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Copy, MessageSquareText } from "lucide-react";

import {
  buildSnapshotText,
  SNAPSHOT_PURPOSES,
  type SnapshotFormat,
  type SnapshotPurpose,
} from "@/lib/tax/snapshot";
import { buildSnapshotFromState, type TaxViewState } from "@/lib/tax/view";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

export function ChatGptSnapshotDialog({ state }: { state: TaxViewState }) {
  const { year } = state;
  const [open, setOpen] = useState(false);
  // ダイアログを開いた時刻を「計算日時」として出力する（サーバーとの時刻差でずれないよう、開いた時点で確定させる）
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);
  const [purpose, setPurpose] = useState<SnapshotPurpose>("limit");
  const [format, setFormat] = useState<SnapshotFormat>("markdown");

  // 残り枠カードと同じ状態（試算値・控除・上書き・寄付）から組み立てるので、画面の数字と一致する
  const text = useMemo(() => {
    if (!generatedAt) return "";
    const snapshot = buildSnapshotFromState(state, generatedAt, process.env.NEXT_PUBLIC_APP_VERSION || "");
    return buildSnapshotText(snapshot, purpose, format);
  }, [generatedAt, state, purpose, format]);

  function handleOpenChange(next: boolean) {
    if (next) setGeneratedAt(new Date());
    setOpen(next);
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("スナップショットをコピーしました");
    } catch {
      toast.error("コピーできませんでした。下の枠内のテキストを選択してコピーしてください");
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <div className="space-y-3 rounded-md border p-4">
        <p className="text-sm font-semibold">ChatGPTに相談する</p>
        <p className="text-xs text-muted-foreground">
          {year}
          年分の集計値・計算の前提・未確認の項目をまとめてコピーし、ChatGPTに上限額や手続きの漏れを相談できます。個人番号・給与明細画像・口座情報・自治体名は出力に含まれません。寄付明細は日付・金額・申請/証明書の状況を含みます。
        </p>
        <DialogTrigger asChild>
          <Button type="button" variant="outline">
            <MessageSquareText />
            相談用データを作る
          </Button>
        </DialogTrigger>
      </div>

      <DialogContent className="flex max-h-[90dvh] flex-col gap-4 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>ChatGPT相談用スナップショット（{year}年分）</DialogTitle>
          <DialogDescription>
            Asset Managerが集計・試算した値だけを出力します。用途と形式を選び、そのままコピーしてChatGPTに貼り付けてください。
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
          <p className="rounded-md border border-dashed p-3 text-xs leading-relaxed text-muted-foreground">
            正式な上限額の計算・確定申告の提出は
            e-Tax／国税庁のサイトで行ってください。ChatGPTの回答は確認の補助であり、申告の根拠にはできません。
          </p>

          <div className="space-y-1.5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <Label>相談の用途</Label>
              <span className="text-xs text-muted-foreground">先頭に付く相談文が変わります</span>
            </div>
            <Tabs value={purpose} onValueChange={(value) => setPurpose(value as SnapshotPurpose)}>
              <TabsList className="w-full">
                {SNAPSHOT_PURPOSES.map(({ key, label }) => (
                  <TabsTrigger key={key} value={key}>
                    {label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <p className="text-xs text-muted-foreground">
              {SNAPSHOT_PURPOSES.find((p) => p.key === purpose)?.description}
            </p>
          </div>

          <div className="space-y-1.5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <Label>出力形式</Label>
              <span className="text-xs text-muted-foreground">コピーされる内容もこの形式です</span>
            </div>
            <Tabs value={format} onValueChange={(value) => setFormat(value as SnapshotFormat)}>
              <TabsList>
                <TabsTrigger value="markdown">Markdown</TabsTrigger>
                <TabsTrigger value="json">JSON</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`snapshot-${year}`}>コピーされる内容</Label>
            <Textarea
              id={`snapshot-${year}`}
              readOnly
              value={text}
              rows={12}
              className="max-h-64 font-mono text-xs"
            />
          </div>
        </div>

        <DialogFooter className="items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            コピー後、ChatGPTの入力欄にそのまま貼り付けてください
          </p>
          <Button type="button" onClick={handleCopy}>
            <Copy />
            この内容をコピー
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
