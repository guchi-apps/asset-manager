#!/usr/bin/env bash
# 本番デプロイで、app-deploy-gate が `prisma migrate deploy` の直前に実行する（guchi-apps/vps
# scripts/app-deploy-gate.sh）。cwd は置き場、DATABASE_URL はマイグレーション用の接続先。
# 終了コードが0以外なら、gate はマイグレーションに進まずデプロイを止める。
#
# 失敗で止まったマイグレーション（_prisma_migrations に finished_at も rolled_back_at も無い行）が
# 残っていると、Prisma は以降のマイグレーションを P3009 で止める（実例: #1630・#1633）。
# ここではその記録を「ロールバック済み」にして、migrate deploy に同じマイグレーションを流し直させる。
#
# ただし MySQL/MariaDB の DDL はトランザクションで巻き戻らないため、途中で落ちたマイグレーションは
# 部分的に適用されている。無条件に流し直すと、部分適用の上に重ねてスキーマ・データを壊しうる。
# そこで、次の条件をすべて満たすときだけ自動で解消し、それ以外は理由を出して止める（#1636）。
#   - 失敗の記録が1件だけ
#   - そのマイグレーションの migration.sql が配布物にあり、`-- pre-migrate: retry-safe` の行を持つ
#     （書き手が「先頭から流し直しても安全」と宣言したもの。書き方は CLAUDE.md）
#   - 同じマイグレーションをまだロールバック済みにしたことが無い（2回目は同じ理由で落ちるだけなので止める）
set -euo pipefail

RETRY_SAFE_MARKER="-- pre-migrate: retry-safe"
MIGRATIONS_DIR="prisma/migrations"

# migrate status の出力文面・終了コードに依存しないよう、履歴の表を直接読む。
# 1行1件で「名前<TAB>過去にロールバック済みにした回数<TAB>失敗時のログの先頭（改行は空白へ）」を出す。
# shellcheck disable=SC2016  # ${...} は JS のテンプレートリテラルで、シェルでは展開しない
failed="$(node -e '
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
(async () => {
  try {
    const rows = await prisma.$queryRawUnsafe(`
      SELECT f.migration_name AS name,
        (SELECT COUNT(*) FROM _prisma_migrations r
          WHERE r.migration_name = f.migration_name AND r.rolled_back_at IS NOT NULL) AS rolledBack,
        f.logs AS logs
      FROM _prisma_migrations f
      WHERE f.finished_at IS NULL AND f.rolled_back_at IS NULL
      ORDER BY f.started_at`);
    for (const row of rows) {
      const logs = String(row.logs ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
      process.stdout.write(`${row.name}\t${Number(row.rolledBack)}\t${logs}\n`);
    }
  } catch (error) {
    // 履歴の表がまだ無い（初回のマイグレーション前）なら、解消するものも無い
    if (error?.meta?.code === "1146") return;
    throw error;
  } finally {
    await prisma.$disconnect();
  }
})().catch((error) => { console.error(error); process.exit(1); });
')"

if [ -z "$failed" ]; then
  echo "pre-migrate: 失敗で止まっているマイグレーションは無い（何もしない）"
  exit 0
fi

stop() {
  echo "pre-migrate: $1" >&2
  echo "pre-migrate: 自動では解消しない。本番デプロイの復旧手順（CLAUDE.md の「本番デプロイが止まったとき」）に従って直す" >&2
  exit 1
}

count="$(printf '%s\n' "$failed" | wc -l)"
if [ "$count" -ne 1 ]; then
  printf '%s\n' "$failed" | cut -f1 | sed 's/^/pre-migrate:   /' >&2
  stop "失敗の記録が ${count} 件ある（1件のときしか自動で解消しない）"
fi

IFS=$'\t' read -r name rolled_back logs <<<"$failed"
echo "pre-migrate: ${name} が失敗で止まっている"
echo "pre-migrate:   失敗時のログ: ${logs:-（なし）}"

sql="${MIGRATIONS_DIR}/${name}/migration.sql"
if [ ! -f "$sql" ]; then
  stop "${sql} が配布物に無い（別の版で適用しようとした記録の可能性がある）"
fi
if ! grep -qxF -- "$RETRY_SAFE_MARKER" <(tr -d '\r' <"$sql"); then
  stop "${name} は「${RETRY_SAFE_MARKER}」を宣言していない。途中まで適用されている可能性があり、流し直すとスキーマ・データを壊しうる"
fi
if [ "$rolled_back" -gt 0 ]; then
  stop "${name} は既に ${rolled_back} 回ロールバック済みにして流し直し、また失敗している（同じ理由で落ち続けるため止める）"
fi

echo "pre-migrate: ${name} は再実行可能と宣言しているので、失敗の記録をロールバック済みにして流し直させる"
npx --no-install prisma migrate resolve --rolled-back "$name"
