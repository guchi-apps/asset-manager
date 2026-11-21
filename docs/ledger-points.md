# 口座タブの「ポイント」区画（#1533）

家計簿の口座タブの、円の口座グループの後ろ（非表示の口座の前）に「ポイント」区画を出す。**円の合計には含めない。**

- **Zaimのポイント・マイル**: AIDEの `GET /api/money/summary` の `points`（`name`・`amount`・`unit`・`lastUpdatedAt`）を1件1カードで出す。
  読むのは管理者（`isZaimAllowedEmail`）だけ。`points` が無い古いキャッシュでは出ない（AIDE側は guchi-apps/aide#872）
- **単位**: AIDEの `unit`（`point`/`mile`）を優先し、無ければ名前の「マイル」「マイレージ」で決める（`lib/ledger-points.ts`）。
  Zaimはマイルにもptと¥相当を付けるが、円としては扱わない
- **古い表示**: `lastUpdatedAt` が3日より前なら `isExternalBalanceStale` で目立たせ、上の「古い口座があります」にも並べる。
  AIDEが結び付けられず `null` のときは「古い」は出ない
- **家計簿の口座（種類が「ポイント」）**: カフェテリアポイントなど。円の口座グループ・総合計から外し、この区画に
  いつもの口座カード（押すと取引履歴）で出す。並び替えの保存では非表示の口座と同じく末尾に保つ
- **AIDEの読み込み**: 口座タブの表示（`getExternalBalancesAction`）だけが `includePoints` を付けて読む。残高合わせは付けないので、
  ポイントのためにAIDEへの依存は増えない
