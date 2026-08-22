#!/usr/bin/env bash
# Verify all op:// references in 1Password env templates resolve correctly.
# ローカル開発（npm run dev）は 1Password 不要（.env.local を使用）のため対象外。
# 本番DB確認まわりのテンプレートのみ検証する。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v op >/dev/null 2>&1; then
  echo "❌ 1Password CLI (op) が見つかりません"
  exit 1
fi

if ! op whoami >/dev/null 2>&1; then
  echo "❌ 1Password CLI にサインインしていません"
  echo ""
  echo "次のいずれかで認証してください:"
  echo "  1. 1Password デスクトップアプリ連携を有効化"
  echo "  2. op account add && eval \"\$(op signin)\""
  echo "  3. export OP_SERVICE_ACCOUNT_TOKEN=..."
  exit 1
fi

echo "✅ Signed in as: $(op whoami)"
echo ""

print_diagnostics() {
  echo "--- 診断情報 ---"
  echo "アクセス可能な Vault:"
  op vault list 2>&1 || true
  echo ""
  echo "apps Vault 内のアイテム:"
  op item list --vault apps 2>&1 || echo "  (apps Vault のアイテム一覧を取得できません)"
  echo ""
}

failed=0
checked=0

verify_tpl() {
  local tpl="$1"
  echo "=== $tpl ==="

  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line//$'\r'/}"

    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${line// }" ]] && continue
    [[ "$line" != *"op://"* ]] && continue

    key="${line%%=*}"
    key="${key//$'\r'/}"
    ref="${line#*=}"
    ref="${ref#"${ref%%[![:space:]]*}"}"
    ref="${ref//$'\r'/}"

    set +e
    err="$(op read "$ref" 2>&1)"
    status=$?
    set -e

    if [[ "$status" -eq 0 ]]; then
      echo "  ✅ $key"
      checked=$((checked + 1))
    else
      echo "  ❌ $key  →  $ref"
      echo "       $(echo "$err" | head -1)"
      failed=$((failed + 1))
    fi
  done < "$tpl"

  echo ""
}

# デプロイ・CIは実行時に1Passwordを読まなくなったため（#175）、
# `.github/deploy.env.tpl` / `.github/ci.env.tpl` は削除済み。
# GitHub側の値の正しさは scripts/sync-github-secrets.sh --dry-run で確認する。
verify_tpl ".env.1password.prod.tpl"

if [[ "$failed" -gt 0 ]]; then
  print_diagnostics
  echo "結果: ${checked} 件成功, ${failed} 件失敗"
  echo ""
  echo "よくある原因:"
  echo "  - 1Password に AssetManager アイテムが未作成"
  echo "  - フィールド名がテンプレートと一致していない"
  echo "  - Service Account に apps Vault への読み取り権限がない"
  echo "  - テンプレートファイルが CRLF 改行（\\r）になっている"
  echo ""
  echo "フィールド確認例:"
  echo "  op item get AssetManager --vault apps --format json | jq '.fields[] | {label, id}'"
  exit 1
fi

echo "--- DATABASE_URL assembly test (prod) ---"
if op run --env-file=.env.1password.prod.tpl -- bash scripts/construct-database-url.sh bash -c '
  [[ -n "${DATABASE_URL:-}" ]] || exit 1
  [[ "$DATABASE_URL" == mysql://* ]] || exit 1
  [[ "$DATABASE_URL" != *"op://"* ]] || exit 1
  echo "  ✅ DATABASE_URL assembled (value hidden)"
'; then
  echo ""
else
  echo "  ❌ DATABASE_URL の組み立てに失敗"
  failed=$((failed + 1))
fi

if [[ "$failed" -gt 0 ]]; then
  echo "結果: ${checked} 件成功, ${failed} 件失敗"
  exit 1
fi

echo "結果: すべて成功 (${checked} 件)"
