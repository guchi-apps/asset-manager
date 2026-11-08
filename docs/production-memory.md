# 本番のメモリ上限と「Service Unavailable」（#1151）

## 症状

本番（`asset.gucchii.com`）で、数分〜数十分おきに次の画面が出る。

```
Service Unavailable
The server is temporarily unable to service your request due to maintenance downtime or capacity problems.
Apache/2.4.58 (Ubuntu) Server at asset.gucchii.com Port 443
```

これは**アプリではなくApacheが返す503**で、裏のNext.js（`localhost:3102`）に繋がらないときに出る。
アプリのエラー画面（500）とは別物。

## 原因（2026-11-08 に確認）

PM2の `max_memory_restart` による強制再起動。`ecosystem.config.js` の値は、VPSが2GBだった
2026-08 に全アプリ一律で決めた `--max-old-space-size=128` / `max_memory_restart: 320M`
（guchi-apps/vps#62）のままだった。その後に家計簿などの機能が増え、プロセスのRSSが上限を常に超えるようになった。

| 観測 | 値 |
|---|---|
| 起動直後のRSS | 約130MB |
| 画面を数枚開いたあとのRSS | 350〜375MB（最大 405MB） |
| 内訳（smaps） | `[heap]`（ネイティブのmalloc）194MB・V8を含む `[anon]` 90MB・node本体 56MB |
| 再起動回数 | デプロイ（12:10）から40分で7回 |
| 12:54 の再起動 | Apacheのエラーログに該当時刻の記録なし＝利用者のリクエストが無いまま上限超過で再起動された |

Apacheのエラーログ（`/var/log/apache2/asset.gucchii.com-error.log`）は11/6夜から急増し、
それまで1日1KB未満だったのが11/7は524行になった。出ているのは次の2種類で、どちらも再起動の跡。

- `AH01102: error reading status line from remote server localhost:3102` — 応答の途中でプロセスが消えた
- `AH00957: ... (111)Connection refused` — 再起動して待ち受けを再開するまでの間

対策として `--max-old-space-size=256` / `max_memory_restart: 640M` に上げた（issue-deck と同程度）。
**`ecosystem.config.js` の変更は次のmainデプロイで反映される**（gateが `pm2 delete → pm2 start` するため）。

## 調べ方

`guchi` から読み取り専用で次が使える（本番のシェルで何かを変える操作は不要）。

```bash
# PM2の各プロセスのRSS・再起動回数・node_args（github-user の PM2 を読み取り専用で見る口）
ssh vps 'sudo -n -u github-user /usr/local/sbin/vps-memory-report' | grep -E 'name=asset-manager |cwd=asset-manager' -A12

# Apacheのエラーを分単位で数える（adm グループで読める）
ssh vps 'grep -E "AH01102|AH00957" /var/log/apache2/asset.gucchii.com-error.log \
  | sed -E "s/^\[\w+ (\w+ \w+ [0-9:]{5}).*(AH[0-9]+).*/\1 \2/" | uniq -c'
```

`restart_time` が増え、`monit_memory` が `max_memory_restart` 付近を上下していれば同じ原因。
PM2自身のログ（`/home/github-user/.pm2/logs`）は `guchi` からは読めない。

## ネイティブヒープ（`[heap]`）が膨らむ原因（#1154）

**評価額の日付キーを作るたびに、ICUの日付フォーマッタを新しく作っていた。**
`lib/valuation-day.ts` の `getCalendarDayKey` が `date.toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" })`
だった。V8は `toLocale*` に options を渡されるとフォーマッタをキャッシュせず、呼ぶたびにICUの
`SimpleDateFormat`・`DateFormatSymbols` などを作る。その確保はV8のヒープではなくmalloc（メインスレッドなので
`[heap]`）に載り、GCで解放されても断片化したまま縮まない。`getFinancialSnapshot`（ダッシュボード・資産・
リバランスなど）は評価額の全行ぶん何度もこれを呼ぶため、データが多いほど1回の表示で大きく膨らむ。

モジュールで `Intl.DateTimeFormat` を1つ作って使い回す形に直した（`receipt-service.ts` の `toJstDayKey`・
Zaim明細の月キーも同じ関数へ寄せた）。

### 実測（ローカルの本番ビルド、評価額 約1.8万行＝25カテゴリ×730日）

| 計測 | 修正前 | 修正後 |
|---|---|---|
| `/` を1回開いたあとの `[heap]` | 8MB → 約0.9GB | 9MB → 11MB |
| 家計簿・資産など11画面を8周したあとの `[heap]` | 1.8GB | 26MB |
| `getFinancialSnapshot` 1回の所要時間 | 約4秒 | 約0.4秒 |
| 単体: `toLocaleDateString(…, { timeZone })` を5.5万回 | `[heap]` +64MB・3秒 | 使い回しで +0MB・75ms |

V8のヒープ上限（`--max-old-space-size` 128/256/1024）を変えても修正前の膨らみ方は同じだった。
**上限の引き上げ（#1151）は、本番で修正後のRSS・再起動回数を測るまで戻さない。**

### 調べ方（次に同じことが起きたとき）

1. ローカルで本番ビルドを `next start` し、`/proc/<pid>/smaps` を領域名ごとに合計して `[heap]` と `[anon]` を見る。
   ログインの背後の画面は、`lib/dev-auth.ts` の `NODE_ENV !== "production"` を**一時的に**外してビルドすれば
   開発用ログインで開ける（コミットしない）。ダミーユーザーには本番並みの件数のデータを入れないと再現しない
2. 画面を1つずつ、サーバーを起動し直して開き、どの画面で `[heap]` が跳ねるかを切り分ける
3. 跳ねる画面で `strace -f -k -e trace=brk` を付けて起動し、`brk` を呼んだネイティブのスタックを集計する。
   JSのフレームは出ないが、mallocの呼び出し元（今回は `icu_78::DateFormatSymbols` など）は分かる
   （`perf` は `perf_event_paranoid=4` で使えない）
4. 呼び出し元が分かったら、該当の処理だけを `tsx` で実行して前後の `[heap]` を比べる（CLAUDE.md の
   「サーバーアクションはローカルDBに対して直接実行して確かめられる」のフックが使える）

## 残っていること

- 上の試験データでは、修正後もV8側の `[anon]` が11画面×8周で約490MBまで増えた（`--max-old-space-size=128`）。
  同じデータでは `getFinancialSnapshot` の結果が約3MBになり、`unstable_cache` の上限（2MB）を超えて
  `Failed to set Next.js data cache … items over 2MB can not be cached` が出て、毎回DBから読み直していた。
  本番のデータ量で同じかは、PM2のログが `guchi` から読めないため未確認
- 再起動・デプロイで一瞬落ちると、Apacheの `ProxyPass` が `retry` 未指定（既定60秒）のため、
  バックエンドが戻っても最大60秒は503を返し続ける。Apacheの設定は guchi-apps/vps 側（guchi-apps/vps#334）
