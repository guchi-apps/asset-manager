#!/usr/bin/env bash
# 検証DB（既定 asset_manager_verify）を作り、検証用ユーザーへ権限を付ける。初回のみ実行する。
# Linux（subpc）は MySQL の管理者権限が要るため sudo を使う（対話シェルで実行する）。
# macOS（Mac mini）は Homebrew の mysql@8.0 を `mysql -u root`（sudo 不要）で操作する（#1539）。
# 事前に `brew install mysql@8.0 && brew services start mysql@8.0` で常駐させておく。
set -euo pipefail

DB_NAME="${VERIFY_DB_NAME:-asset_manager_verify}"
DB_USER="${VERIFY_DB_USER:-asset_manager}"
DB_PASSWORD="${VERIFY_DB_PASSWORD:-devpassword}"

if [[ "$(uname -s)" == "Darwin" ]]; then
  MYSQL_ADMIN=(mysql -u root)
else
  MYSQL_ADMIN=(sudo mysql)
fi

"${MYSQL_ADMIN[@]}" <<SQL
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- MySQL 8系はユーザー未作成のGRANTがエラーになるため先に作る（既存なら何もしない）
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';
-- 127.0.0.1 で接続する場合に備える（macOS の Homebrew 版は名前解決の結果が localhost とは限らない）
CREATE USER IF NOT EXISTS '${DB_USER}'@'127.0.0.1' IDENTIFIED BY '${DB_PASSWORD}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL
echo "✅ 検証DB ${DB_NAME} を用意しました。確認: npm run verify:build"
