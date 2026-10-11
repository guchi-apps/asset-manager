#!/usr/bin/env bash
# 検証DB（既定 asset_manager_verify）を作り、検証用ユーザーへ権限を付ける。初回のみ実行する。
# MySQL の管理者権限が要るため sudo を使う（対話シェルで実行する）。
set -euo pipefail

DB_NAME="${VERIFY_DB_NAME:-asset_manager_verify}"
DB_USER="${VERIFY_DB_USER:-asset_manager}"
DB_PASSWORD="${VERIFY_DB_PASSWORD:-devpassword}"

sudo mysql <<SQL
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- MySQL 8系はユーザー未作成のGRANTがエラーになるため先に作る（既存なら何もしない）
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
SQL
echo "✅ 検証DB ${DB_NAME} を用意しました。確認: npm run verify:build"
