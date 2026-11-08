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

## 残っていること

- ネイティブヒープ（`[heap]`）が何で膨らむのかは特定できていない（#1154）
- 再起動・デプロイで一瞬落ちると、Apacheの `ProxyPass` が `retry` 未指定（既定60秒）のため、
  バックエンドが戻っても最大60秒は503を返し続ける。Apacheの設定は guchi-apps/vps 側（guchi-apps/vps#334）
