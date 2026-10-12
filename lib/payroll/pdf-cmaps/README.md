# pdf-cmaps

給与明細PDFの取り込み（`/api/salaries/import-pdf`。明細ラボ#256から #714 で移管）で、日本語の文字コード（`90ms-RKSJ-H` など）を
Unicode へ戻すために pdf.js が読む CMap ファイル。`unpdf` は CMap を同梱していないため、
`pdfjs-dist@5.7.284` の `cmaps/` から日本語（Adobe-Japan1）用のものだけを複製している。
ライセンスは同ディレクトリの `LICENSE`（Adobe、BSD-3-Clause）。

`public/` に置くとPWAの事前キャッシュ（serwist）の対象になるため、本番のデプロイ資材
（`.github/workflows/deploy.yml`）に含まれる `lib/` の下に置いている。
