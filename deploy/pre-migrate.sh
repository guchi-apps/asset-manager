#!/usr/bin/env bash
# 本番デプロイで、app-deploy-gate が `prisma migrate deploy` の直前に実行する（guchi-apps/vps
# scripts/app-deploy-gate.sh）。cwd は置き場、DATABASE_URL はマイグレーション用の接続先。
#
# v9.0.0 の 20261227120000_fix_tag_groups は、本番のマイグレーション用ユーザーに
# CREATE TEMPORARY TABLES 権限が無く 1044 で失敗し、_prisma_migrations に「失敗」として残った（#1630・#1633）。
# 失敗が残っている間は Prisma が以降のマイグレーションを P3009 で止めるため、そのときだけ
# 「ロールバック済み」にして、修正版（#1631。key 列が既にあっても通る）を適用し直させる。
# 失敗扱いでなければ何もしない。本番で解消を確かめたら、このファイルごと消してよい。
set -euo pipefail

MIGRATION_NAME="20261227120000_fix_tag_groups"

# migrate status の出力文面・終了コードに依存しないよう、履歴の表を直接読む。
# shellcheck disable=SC2016  # ${...} は JS のテンプレートリテラルで、シェルでは展開しない
failed="$(MIGRATION_NAME="$MIGRATION_NAME" node -e '
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
(async () => {
  try {
    const rows = await prisma.$queryRaw`
      SELECT COUNT(*) AS n FROM _prisma_migrations
      WHERE migration_name = ${process.env.MIGRATION_NAME}
        AND finished_at IS NULL AND rolled_back_at IS NULL`;
    process.stdout.write(String(Number(rows[0].n)));
  } catch (error) {
    // 履歴の表がまだ無い（初回のマイグレーション前）なら、解消するものも無い
    if (error?.meta?.code === "1146") { process.stdout.write("0"); return; }
    throw error;
  } finally {
    await prisma.$disconnect();
  }
})().catch((error) => { console.error(error); process.exit(1); });
')"

if [ "$failed" = "0" ]; then
  echo "pre-migrate: ${MIGRATION_NAME} に失敗の記録は無い（何もしない）"
  exit 0
fi

echo "pre-migrate: ${MIGRATION_NAME} の失敗の記録をロールバック済みにする（${failed} 件）"
npx --no-install prisma migrate resolve --rolled-back "$MIGRATION_NAME"
