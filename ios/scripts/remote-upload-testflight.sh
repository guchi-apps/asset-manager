#!/usr/bin/env bash
# subpc から Tailscale 越しに Mac へ入って、AssetManager を TestFlight へアップロードする（#1106）。
# subpc に Xcode が無いため、ビルドとアップロードだけ Mac 側で行う。
#
#   ios/scripts/remote-upload-testflight.sh
#
# 環境変数（すべて任意）:
#   MAC_HOST      SSH先（既定 guchimac-mini）
#   MAC_REPO_DIR  Mac 上のチェックアウト（既定 $HOME/apps/asset-manager）。チルダ付きで渡さない
#                 （subpc のシェルが先に展開するため）。'$HOME/x' のようにシングルクォートで渡す
#   IOS_BRANCH / IOS_SKIP_PULL / IOS_BUILD_NUMBER は upload-testflight.sh へそのまま渡す
#
# Mac 側の前提: Xcode・1Password CLI（op）にサインイン済み・ログインキーチェーンが開いている
# （SSH 経由の署名は自動で開かないため、codesign が失敗したら Mac で
#  `security unlock-keychain ~/Library/Keychains/login.keychain-db` を一度実行する）。
set -euo pipefail

HOST="${MAC_HOST:-guchimac-mini}"
REPO_DIR="${MAC_REPO_DIR:-\$HOME/apps/asset-manager}"

pass=""
for name in IOS_BRANCH IOS_SKIP_PULL IOS_BUILD_NUMBER; do
  if [ -n "${!name:-}" ]; then
    pass+="$name=$(printf '%q' "${!name}") "
  fi
done

# 終了コードをパイプで隠さない（| tee 等を付けない）。-t は op のサインイン要求・キーチェーンの入力用
ssh -t "$HOST" "cd \"$REPO_DIR\" 2>/dev/null || { echo \"$REPO_DIR が Mac に無いため中止します。MAC_REPO_DIR で場所を指定してください。\" >&2; exit 1; }; ${pass}op run --env-file=ios/asc.env.tpl -- bash ios/scripts/upload-testflight.sh"
