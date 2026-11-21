#!/usr/bin/env bash
# subpc の作業ツリーの ios/ を Tailscale 越しに Mac へ送り、署名なしでビルドできるか確かめる（#1106）。
# subpc に Xcode が無いため、Swift の変更をコミットする前に「コンパイルが通るか」を見る用途。
# 署名・アーカイブ・TestFlightへのアップロードはしない（それは remote-upload-testflight.sh / CI）。
#
#   ios/scripts/remote-build-check.sh
#
# 環境変数（すべて任意）:
#   MAC_HOST      SSH先（既定 guchimac-mini）。`local` を指定すると SSH せずこのマシンで実行する
#   MAC_WORK_DIR  Mac 上の作業ディレクトリ（既定 /tmp/asset-manager-ios-build-check）。毎回この中身を置き換える
#
# `uname -s` が Darwin（Mac 自身で実行している。Mac mini の実装セッション等）のときは
# 自分自身へ SSH せず、MAC_HOST=local と同じくローカルで実行する（#1535）。
#
# 実機での動作（日本語入力・キーボード・TestFlightからの起動）はここでは確かめられない。
set -euo pipefail

HOST="${MAC_HOST:-guchimac-mini}"
WORK_DIR="${MAC_WORK_DIR:-/tmp/asset-manager-ios-build-check}"
IOS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ "$HOST" = "local" ] || [ "$(uname -s)" = "Darwin" ]; then
  LOCAL=1
else
  LOCAL=0
fi

# Mac 側で実行するビルド。生成物は作業ディレクトリ内の DerivedData に閉じる。
# pipefail で xcodebuild の失敗を tail に隠させない（Mac のログインシェルは zsh で
# PIPESTATUS が無く、以前は失敗が成功として返りうった）。
IFS= read -r -d '' BUILD_SCRIPT <<EOS || true
set -eo pipefail
cd '$WORK_DIR/ios'
xcodebuild \\
  -project AssetManager.xcodeproj -scheme AssetManager -configuration Debug \\
  -destination 'generic/platform=iOS Simulator' \\
  -derivedDataPath '$WORK_DIR/DerivedData' \\
  CODE_SIGNING_ALLOWED=NO build 2>&1 | tail -n 8
EOS

if [ "$LOCAL" = 1 ]; then
  mkdir -p "$WORK_DIR/ios"
  rsync -a --delete --exclude build --exclude DerivedData "$IOS_DIR/" "$WORK_DIR/ios/"
  bash -c "$BUILD_SCRIPT"
else
  ssh "$HOST" "mkdir -p '$WORK_DIR'"
  rsync -az --delete --exclude build --exclude DerivedData "$IOS_DIR/" "$HOST:$WORK_DIR/ios/"
  printf '%s\n' "$BUILD_SCRIPT" | ssh "$HOST" 'bash -l -s'
fi
