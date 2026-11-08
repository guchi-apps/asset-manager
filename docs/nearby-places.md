# 現在地から近くのお店を選ぶ（#1171）

家計簿の取引入力ダイアログで、「お店・相手」行の右端の地図アイコンから、現在地の周辺のお店を選べる。

## 仕組み

1. アイコンで `components/ledger/nearby-place-sheet.tsx` の下シートが開き、`navigator.geolocation` で現在地を取る
2. `GET /api/places/nearby?lat=&lon=`（ログイン必須）が `lib/nearby-places.ts` の `fetchNearbyPlaces` を呼ぶ
3. OpenStreetMap の Overpass API（キー不要）へ半径400mで問い合わせ、近い順・同名の重複なし・最大10件へ整える
4. 地図は OpenStreetMap の埋め込み（現在地の印のみ）。店舗の印を地図上に出すには Leaflet 等の依存追加が要り、未承認のため入れていない

## プライバシー

- 位置情報はDB・ログへ保存しない。Overpass へは小数3桁（約100m）へ丸めて送る
- 失敗時のエラーに座標を含めない

## 制約・注意

- Overpass は無料の共有サービスで遅い・落ちる。2系統へ順に当て、全体で8秒で諦める（その場合は手入力へ誘導）
- APIルートの連続呼び出しはユーザーごとに2秒の間隔を空ける（サーバープロセス内の記録のため、PM2を複数プロセスにすると緩くなる）
- **iOSアプリ**は WKWebView の位置情報にアプリ側の許可が要る。`ios/AssetManager.xcodeproj/project.pbxproj` の
  `INFOPLIST_KEY_NSLocationWhenInUseUsageDescription` が利用目的の文言で、**アプリの出し直しが必要**
- Web版（Safari等）で動かすには、本番のApacheが `Permissions-Policy: geolocation=()` を返していないことが前提（未確認）
- 実際のOverpassへの問い合わせは、実装時にサンドボックスから外部へ通信できず未確認。単体テストは `fetch` をスタブしている
