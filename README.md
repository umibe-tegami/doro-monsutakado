# ドローモンスターカード（独立版 / Render公開用）

Museスペース版を正本として再現した、通常のNode.jsアプリ版です。

## 構成
- `server/` … Express API。DBは `DATABASE_URL` があれば PostgreSQL、無ければローカルSQLite（`.data/game.db`）
- `client/` … React + Vite + TypeScript。`npm run build` で `dist/` に出力し、サーバーが配信
- `data/` … 図鑑カタログ（全151種）と背景・裏面デザイン定義
- プレイヤー識別は localStorage のUUID（ログインなし）

## ローカル実行
```bash
npm install
npm run build
npm start          # http://localhost:3000
```

## Renderへのデプロイ
`render.yaml`（Blueprint）を使うか、手動で Web Service を作成：
- Build Command: `npm install && npm run build`
- Start Command: `npm start`
- Plan: Starter
- PostgreSQL（Basic 256MB）を用意し、`DATABASE_URL` を連携
- 環境変数 `REDEMPTION_CODES_SEED` に解除コードのシードJSONを設定（下記）

## 解除コードのシード（重要）
コード実物はこのリポジトリに**含まれていません**。サーバー初回起動時に
環境変数 `REDEMPTION_CODES_SEED`（JSON: `{"CODE":"item_id", ...}`）からDBへ投入されます。

シードJSONの生成（コード一覧ファイルのあるフォルダで）:
```bash
CODES_DIR=/path/to/codes node scripts/make-seed.mjs > seed.json
```
`seed.json` は `.gitignore` 済みです。生成したJSONはRenderの環境変数にだけ貼り、
ファイルはリポジトリにコミットしないでください。

## BGMクレジット
- 通常： 「戦いの旅路を征く」by MATSU（OpenTracks / 旧DOVA-SYNDROME、商用可・表記不要）
- アルティメット中： 「Do not go against me」by yourai（同上）
