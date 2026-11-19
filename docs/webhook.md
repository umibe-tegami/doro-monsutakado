# Stripe Webhook 自動付与（運用メモ）

支払い完了と同時にアイテムを自動で付与する仕組みです。従来の「解除コードを
メールで送る」方式は**併用可能**で、コード入力も引き続き使えます。

## 仕組み

1. ショップの「購入する（Stripe）」リンクには、開くときに
   `?client_reference_id=<プレイヤーID>` が自動で付きます。
2. 支払いが完了すると Stripe が `POST /webhooks/stripe` に
   `checkout.session.completed` イベントを送ります。
3. サーバーは署名を検証し、`client_reference_id` のプレイヤーへ、
   `amount_total`（円）に応じた内容を付与します。

金額 → 付与内容の対応表は `server/stripe-webhook.js` の
`STRIPE_GRANTS_JPY` が唯一の定義場所です。

| 金額 | 付与 |
|---|---|
| 280円 | 広告無期限廃止（ad_free） |
| 120円 | 300ソウル |
| 320円 | 1,000ソウル |
| 680円 | 2,500ソウル |
| 1,280円 | 5,500ソウル |
| 2,940円 | 14,000ソウル |
| 5,860円 | 30,000ソウル |

ソウル付与は残高と「総ソウル獲得数」（ランキング用累計）の両方に加算されます。

### 安全策

- **署名検証**：`STRIPE_WEBHOOK_SECRET` で Stripe-Signature を検証。
  未設定のときはエンドポイント自体が 503 を返し、無効化されます。
  署名が合わないリクエストは 400 です。
- **二重付与防止**：処理したイベントIDをDBの `stripe_events` テーブルに
  記録し、Stripeからの再送・重複配信では付与をスキップします。
- **付与できない場合**（プレイヤーIDなし／存在しないプレイヤー／
  未知の金額／円以外の通貨）：付与せずサーバーログにエラーを残し、
  200 を返します（Stripeの再送ループを避けるため）。
  結果は `stripe_events.result` にも残ります
  （例：`granted:souls:1000`、`skipped:unknown_amount`）。

## ローカル検証

```bash
node scripts/test-webhook.mjs
```

署名付きのテストイベントを自前で生成して実際のサーバーに投げ、
付与・二重防止・未知金額・プレイヤー不在・署名エラー・無効化（503）
の各ケースを確認します。実Stripeには接続しません。

## 本番化の手順（残作業）

前提：本番サイトが **https** で公開されていること
（Stripeの本番Webhookは https のURLが必須です）。

1. **Stripeダッシュボードでエンドポイントを登録**
   - Stripeダッシュボード →「開発者」→「Webhook」→「エンドポイントを追加」
   - エンドポイントURL：`https://ik1-322-21344.vs.sakura.ne.jp/webhooks/stripe`
   - リッスンするイベント：`checkout.session.completed` を選択
2. **署名シークレットをサーバーに設定**
   - 登録後に表示される署名シークレット（`whsec_...`）を控える
   - サーバー（さくらのVPS）の環境変数ファイル `/etc/doro-monsutakado.env` に
     `STRIPE_WEBHOOK_SECRET=<控えた値>` を1行追加する
3. **サービスを再起動**
   ```bash
   sudo systemctl restart doro-monsutakado
   ```
4. **確認**
   - Stripeダッシュボードの Webhook 送信ログで、テスト送信が
     200 になっていることを見る
   - 実際に少額のソウルパック（120円）を購入し、コード入力なしで
     ソウルが増えることを確認する
   - うまくいかない場合はサーバーログを確認：
     `journalctl -u doro-monsutakado | grep stripe-webhook`

### 本番化後のメモ

- 動作確認が済んだら、ショップ画面の案内文（「ご購入後、解除コードを
  メールでお送りします」）を自動付与の案内に更新すると親切です。
  解除コード方式はそのまま残るので、既に送付済みのコードも使えます。
- 支払いリンク側の変更は不要です（`client_reference_id` はリンクを
  開くときにクライアントが付けます）。
