// サーバー専用（pdf.js でPDFを開く）。クライアントコンポーネントから import しないこと。
import path from "node:path";

import { getDocumentProxy } from "unpdf";

import { parsePayslipText } from "@/lib/payroll/payslip-pdf";
import type { ParsedPayslip, PdfTextItem } from "@/lib/payroll/payslip-pdf";

// 日本語の文字コード（90ms-RKSJ-H など）を Unicode に戻す CMap。unpdf は同梱していないため
// lib/payroll/pdf-cmaps に置いている。public/ に置くと PWA の事前キャッシュ（serwist）に約430KBぶん載ってしまうため、
// 本番のデプロイ資材（.github/workflows/deploy.yml）に含まれる lib/ の下にしている（#714）。
// これが無いと、日本語の項目名が1文字も取り出せない。
const CMAP_URL = path.join(process.cwd(), "lib", "payroll", "pdf-cmaps") + path.sep;

// pdf.js の PasswordResponses
const NEED_PASSWORD = 1;

export type PayslipPdfResult =
  | { ok: true; parsed: ParsedPayslip }
  | { ok: false; error: string; needsPassword?: boolean };

/** 給与明細PDFの1ページ目から項目名と金額の行を読み取る。PDFはどこにも保存しない */
export async function readPayslipPdf(bytes: Uint8Array, password?: string): Promise<PayslipPdfResult> {
  let items: PdfTextItem[];
  try {
    const pdf = await getDocumentProxy(bytes, {
      cMapUrl: CMAP_URL,
      cMapPacked: true,
      password: password || undefined,
      verbosity: 0,
    });
    try {
      // 2ページ目以降（福祉制度の加入状況など）は明細の金額ではないため読まない
      const page = await pdf.getPage(1);
      const content = await page.getTextContent();
      items = content.items.flatMap((item) =>
        "str" in item ? [{ str: item.str, x: item.transform[4], y: item.transform[5] }] : []
      );
    } finally {
      await pdf.loadingTask.destroy();
    }
  } catch (error) {
    if (error instanceof Error && error.name === "PasswordException") {
      const needsPassword = (error as Error & { code?: number }).code === NEED_PASSWORD;
      return {
        ok: false,
        error: needsPassword
          ? "このPDFにはパスワードがかかっています。パスワードを入力してください"
          : "パスワードが違います",
        needsPassword: true,
      };
    }
    console.error("[payslip-pdf] PDFの読み込みに失敗しました", error);
    return { ok: false, error: "PDFを読み込めませんでした" };
  }

  const parsed = parsePayslipText(items);
  if (parsed.lines.length === 0) {
    return {
      ok: false,
      error: "金額を読み取れませんでした。文字情報を持たない（画像だけの）PDFは読み取れません",
    };
  }
  return { ok: true, parsed };
}
