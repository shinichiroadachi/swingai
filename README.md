# SwingAI — スイングトレード分析ツール

Yahoo Finance のリアルデータ + Claude AI による売買アドバイスを表示するWebアプリです。

---

## 🚀 セットアップ手順

### 1. Node.js のインストール確認
```bash
node --version   # v18以上推奨
npm --version
```

### 2. プロジェクトのセットアップ

**フロントエンド（React）**
```bash
npm install
```

**バックエンド（Express プロキシ）**
```bash
cp server-package.json package-server.json
npm install --prefix server-deps cors express dotenv nodemon
# または
cd ..
mkdir swing-server && cd swing-server
cp ../swing-trader/server.js .
npm init -y
npm install cors express dotenv
```

### 3. APIキーの設定

`.env.example` をコピーして `.env` を作成：
```bash
cp .env.example .env
```

`.env` を開いて Anthropic API キーを入力：
```
ANTHROPIC_API_KEY=sk-ant-あなたのキー
PORT=3001
```

> Anthropic API キーは https://console.anthropic.com で取得できます。

---

## ▶️ 起動方法

**ターミナル1: バックエンドサーバー起動**
```bash
node server.js
# → ✅ Proxy server running on http://localhost:3001
```

**ターミナル2: フロントエンド起動**
```bash
npm start
# → http://localhost:3000 が自動で開きます
```

---

## 📖 使い方

1. 銘柄ボタンをクリック、または銘柄コードを直接入力
   - 日本株: `7203.T`（末尾に `.T`）
   - 米国株: `AAPL`, `NVDA`, `TSLA`
   - 仮想通貨: `BTC-USD`, `ETH-USD`
2. 投資予算（円）を設定
3. 分析期間（1mo / 3mo / 6mo）を選択
4. 「分析する →」をクリック

---

## 📊 表示される情報

| 項目 | 内容 |
|------|------|
| 価格チャート | ボリンジャーバンド・SMA20・SMA50 |
| RSIチャート | 過熱・割安シグナル |
| MACDチャート | 売買タイミング |
| 指標カード | RSI / SMA / MACD / BB位置 / 総合シグナル |
| 購入プラン | 予算内の最大株数・損切り・利確ライン |
| AIアドバイス | Claude が実データを分析した売買推奨コメント |

---

## ⚠️ 免責事項

本ツールは教育・学習目的のみです。投資判断は必ずご自身の責任で行ってください。
Yahoo Finance のデータには遅延がある場合があります。

---

## 🛠️ 技術スタック

- **Frontend**: React 18, Recharts
- **Backend**: Node.js, Express
- **Data**: Yahoo Finance v8 API
- **AI**: Anthropic Claude API (claude-sonnet-4)
