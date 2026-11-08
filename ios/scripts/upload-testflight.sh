#!/usr/bin/env bash
# Mac 上で AssetManager を Archive し、App Store Connect（TestFlight）へアップロードする（#1106）。
#
#   op run --env-file=ios/asc.env.tpl -- ios/scripts/upload-testflight.sh
#
# 環境変数（必須。値は1Passwordで管理し、リポジトリへは置かない）:
#   ASC_KEY_P8       App Store Connect API キー（.p8）の中身をbase64の1行にした値（他のiOSアプリと共用の apps/AppStoreConnect/key-p8）
#   ASC_KEY_ID       キーID
#   ASC_ISSUER_ID    Issuer ID
# 任意:
#   IOS_BUILD_NUMBER ビルド番号（既定は日時 YYYYMMDDHHMM。アップロードのたびに増えれば足りる）
#   IOS_BRANCH       取り込むブランチ（既定 main。Webが本番へ出た後の殻を配るため）
#   IOS_SKIP_PULL=1  git の取り込みを省く（手元の変更をそのまま上げたいとき）
#
# ビルド番号は Archive 時に上書きするだけで pbxproj は書き換えない（コミットが要らない）。
# subpc からは ios/scripts/remote-upload-testflight.sh で Mac へSSHして実行できる（#1106）。
# 版番号（MARKETING_VERSION）は事前に `node ios/scripts/sync-version.mjs` で package.json に揃える。
set -euo pipefail

if [ "$(uname)" != "Darwin" ]; then
  echo "このスクリプトは Mac（Xcode入り）で実行します。" >&2
  exit 1
fi
for v in ASC_KEY_P8 ASC_KEY_ID ASC_ISSUER_ID; do
  if [ -z "${!v:-}" ]; then
    echo "$v が未設定です。1Password の値を op run で渡してください（ios/README.md 参照）。" >&2
    exit 1
  fi
done

# .p8 は一時ファイル（権限600）へ書き出し、終了時（失敗時も）に消す。中身・パスはログに出さない。
# xcodebuild は -authenticationKeyPath で任意のパスを受けるため、altool の private_keys/ 置き場所は要らない
ASC_KEY_DIR="$(mktemp -d)"
trap 'rm -rf "$ASC_KEY_DIR"' EXIT
chmod 700 "$ASC_KEY_DIR"
ASC_KEY_PATH="$ASC_KEY_DIR/AuthKey_${ASC_KEY_ID}.p8"
( umask 077; printf '%s' "$ASC_KEY_P8" | { base64 -D 2>/dev/null || base64 -d; } > "$ASC_KEY_PATH" )
if ! grep -q 'BEGIN PRIVATE KEY' "$ASC_KEY_PATH"; then
  echo "ASC_KEY_P8 をbase64として復号できないか、.p8 の形式ではありません。" >&2
  exit 1
fi

IOS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$IOS_DIR/.." && pwd)"
BRANCH="${IOS_BRANCH:-main}"

if [ "${IOS_SKIP_PULL:-}" != "1" ]; then
  cd "$REPO_ROOT"
  if [ -n "$(git status --porcelain)" ]; then
    echo "作業ツリーに未コミットの変更があるため中止します。退避してから再実行するか、IOS_SKIP_PULL=1 を付けてください。" >&2
    exit 1
  fi
  git fetch origin "$BRANCH"
  git checkout "$BRANCH"
  git merge --ff-only "origin/$BRANCH"
fi
echo "ビルド対象: $(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD) @ $(git -C "$REPO_ROOT" rev-parse --short HEAD)"

BUILD_NUMBER="${IOS_BUILD_NUMBER:-$(date +%Y%m%d%H%M)}"
ARCHIVE="$(mktemp -d)/AssetManager.xcarchive"

node "$IOS_DIR/scripts/check-consistency.mjs"

AUTH=(-allowProvisioningUpdates
  -authenticationKeyPath "$ASC_KEY_PATH"
  -authenticationKeyID "$ASC_KEY_ID"
  -authenticationKeyIssuerID "$ASC_ISSUER_ID")

echo "== Archive（ビルド番号 $BUILD_NUMBER）"
xcodebuild archive \
  -project "$IOS_DIR/AssetManager.xcodeproj" \
  -scheme AssetManager \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE" \
  CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
  "${AUTH[@]}"

echo "== App Store Connect へアップロード"
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportOptionsPlist "$IOS_DIR/ExportOptions.plist" \
  "${AUTH[@]}"

echo "完了。App Store Connect の TestFlight で処理（数分〜）が終わるとインストールできます。"
