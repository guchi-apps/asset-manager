# 現在地から近くのお店を選ぶ（#1171・#1194）

家計簿の取引入力ダイアログで、「お店・相手」行の右端の地図アイコンから、現在地の周辺のお店を選べる。

## 仕組み

1. アイコンで `components/ledger/nearby-place-sheet.tsx` の下シートが開き、`navigator.geolocation` で現在地を取る
2. 現在地が取れた時点で地図（`components/ledger/nearby-place-map.tsx`）を出し、`GET /api/places/nearby?lat=&lon=`（ログイン必須）を呼ぶ
3. `lib/nearby-places.ts` の `fetchNearbyPlaces` が Photon（`photon.komoot.io/reverse`）へ半径500mで問い合わせ、
   近い順・同名の重複なし・最大10件へ整える。Photon が失敗したときだけ Overpass へ回す
4. いちばん近いお店を「いまいるお店？」として大きく出し、残りを近い順の一覧に出す。地図の番号付きの印と一覧の番号は対応する

## 検索元（#1194 で Overpass から Photon へ替えた）

#1171 の初版は Overpass だけを使い、全体8秒で打ち切っていた。サブPCからの実測（2026-11-08）では
Overpass は1回に19〜32秒かかり、502も返したため、**ほぼ毎回打ち切られていた**。

- **Photon**（komoot運営・OSMのデータ・キー不要）の reverse は実測1〜1.6秒で、近い順に返す。締め切り4秒
- `osm_tag` を付けないと駅の番線・住所・自販機などが上位に来るため、`osm_tag=shop` と
  `osm_tag=amenity:<AMENITY_LABELS のキー>` に絞る（複数指定はOR）。すり抜けたものは `parsePhotonResponse` で落とす
- **Overpass** は予備。別枠の10秒だけ待つ（実測からすると当たれば儲けもの）

## 地図

依存を足さないため、OpenStreetMap のタイル画像（`tile.openstreetmap.org`）を並べ、現在地と印を重ねた静的な地図にしている。
動かす・拡大はできず、印が収まるズーム（15〜18）を自動で選ぶ。操作できる地図にするには Leaflet 等の依存追加が要る。

## プライバシー

- 位置情報はDB・ログへ保存しない。外部の検索元（Photon・Overpass）へは小数3桁（約100m）へ丸めて送る
- 距離（近い順・「いまいるお店？」）は自サーバーで**丸める前の座標**から計算する。丸めた座標で測ると
  最大約70mずれ、すぐ隣のお店を取り違えるため。丸めで外れるお店を拾うため、半径は500mにしている
- 地図のタイルはブラウザが OpenStreetMap から直接読む（現在地周辺のタイルを要求する）。#1171 の埋め込み地図と同じ扱い
- 失敗時のエラーに座標を含めない

## 制約・注意

- `getCurrentPosition` の `timeout` は許可ダイアログを待つ時間を数えない。許可が返らないと呼び戻されず、
  #1194 では「検索中…」のまま止まった。シート側で15秒の上限を設け、失敗表示と「もう一度探す」を出す
- APIルートの連続呼び出しはユーザーごとに2秒の間隔を空ける（サーバープロセス内の記録のため、PM2を複数プロセスにすると緩くなる）
- **iOSアプリ**は WKWebView の位置情報にアプリ側の許可が要る。`ios/AssetManager.xcodeproj/project.pbxproj` の
  `INFOPLIST_KEY_NSLocationWhenInUseUsageDescription` が利用目的の文言で、#1171 以降の版のアプリでないと許可が出ない
- Web版（Safari等）で動かすには、本番のApacheが `Permissions-Policy: geolocation=()` を返していないことが前提
  （2026-11-08 に `/login` の応答ヘッダーに `Permissions-Policy` が無いことを確認）
- 単体テストは `fetch` をスタブしている。実際の Photon への問い合わせは、サブPCから `fetchNearbyPlaces` を直接呼んで確かめた
