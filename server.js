require('dotenv').config();
const express = require('express');
const cors = require('cors');
const https = require('https');
const http  = require('http');
const path  = require('path');
const cron  = require('node-cron');
const YahooFinanceLib = require('yahoo-finance2').default;
const yahooFinance = new YahooFinanceLib({ suppressNotices: ['yahooSurvey'] });

// ─── SQLite 初期化 ─────────────────────────────────────────────────
const Database = require('better-sqlite3');
const db = new Database(process.env.DB_PATH || 'holdings.db');
db.exec(`
  CREATE TABLE IF NOT EXISTS holdings (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol     TEXT    NOT NULL,
    name       TEXT,
    shares     REAL    NOT NULL,
    avg_price  REAL    NOT NULL,
    created_at TEXT    DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS alert_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol     TEXT    NOT NULL,
    type       TEXT    NOT NULL,
    sent_at    TEXT    DEFAULT (datetime('now','localtime'))
  );
`);

const app = express();
app.use(cors());
app.use(express.json());

// ─── Yahoo Finance proxy ───────────────────────────────────────────
app.get('/api/stock/:symbol', (req, res) => {
  const { symbol } = req.params;
  const { range = '3mo' } = req.query;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}`;

  https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (yahooRes) => {
    let data = '';
    yahooRes.on('data', chunk => data += chunk);
    yahooRes.on('end', () => {
      try {
        const json = JSON.parse(data);
        res.json(json);
      } catch (e) {
        res.status(500).json({ error: 'Parse error' });
      }
    });
  }).on('error', (e) => {
    res.status(500).json({ error: e.message });
  });
});

// ─── Yahoo Finance fundamentals proxy ─────────────────────────────
app.get('/api/fundamentals/:symbol', async (req, res) => {
  try {
    const data = await yahooFinance.quoteSummary(req.params.symbol, {
      modules: ['summaryDetail', 'defaultKeyStatistics', 'financialData'],
    });
    // Wrap in v10-compatible envelope so api.js parsing works unchanged
    res.json({ quoteSummary: { result: [data] } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Anthropic API proxy ───────────────────────────────────────────
app.post('/api/ai', (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY が設定されていません。.env ファイルに追加してください。' });
  }

  const body = JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    messages: req.body.messages,
  });

  const options = {
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Length': Buffer.byteLength(body),
    },
  };

  const apiReq = https.request(options, (apiRes) => {
    let data = '';
    apiRes.on('data', chunk => data += chunk);
    apiRes.on('end', () => {
      try {
        res.json(JSON.parse(data));
      } catch (e) {
        res.status(500).json({ error: 'Parse error' });
      }
    });
  });

  apiReq.on('error', (e) => res.status(500).json({ error: e.message }));
  apiReq.write(body);
  apiReq.end();
});

// ─── kabu+ API proxy ────────────────────────────────────────────────
// kabu+ API は MarketSpeed II が動いている Windows PC 上の
// http://localhost:18080 に REST サーバーが立ち上がる仕組みです。
// KABU_API_BASE でリモートアドレスに向けることもできます。
const KABU_BASE = process.env.KABU_API_BASE || 'http://localhost:18080';

let _kabuToken = null;
let _kabuTokenAt = 0;

function kabuReq(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(KABU_BASE + '/kabusapi' + path);
    const bodyStr = body ? JSON.stringify(body) : '';
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['X-API-KEY'] = token;
    if (bodyStr) headers['Content-Length'] = Buffer.byteLength(bodyStr);

    const reqFn = u.protocol === 'https:' ? https.request : http.request;
    const req = reqFn(
      { hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 18080),
        path: u.pathname, method, headers },
      (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
          catch { resolve({ status: res.statusCode, body: d }); }
        });
      }
    );
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function getKabuToken() {
  // トークンは24時間有効 → 23時間でリフレッシュ
  if (_kabuToken && (Date.now() - _kabuTokenAt) < 23 * 3600 * 1000) return _kabuToken;
  const pw = process.env.KABUCOM_API_PASSWORD;
  if (!pw) throw new Error('KABUCOM_API_PASSWORD が .env に設定されていません');
  const r = await kabuReq('POST', '/token', { APIPassword: pw });
  if (r.status !== 200) throw new Error('トークン取得失敗: ' + JSON.stringify(r.body));
  _kabuToken = r.body.Token;
  _kabuTokenAt = Date.now();
  return _kabuToken;
}

// 接続確認
app.get('/api/kabu/status', async (req, res) => {
  const hasPw = !!process.env.KABUCOM_API_PASSWORD;
  if (!hasPw) return res.json({ connected: false, mock: true, reason: 'APIパスワード未設定' });
  try {
    await getKabuToken();
    res.json({ connected: true, mock: false });
  } catch (e) {
    res.json({ connected: false, mock: false, reason: e.message });
  }
});

// 買付余力（現物）
app.get('/api/kabu/wallet', async (req, res) => {
  try {
    const token = await getKabuToken();
    const r = await kabuReq('GET', '/wallet/cash', null, token);
    res.json(r.body);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 保有株一覧
app.get('/api/kabu/positions', async (req, res) => {
  try {
    const token = await getKabuToken();
    const r = await kabuReq('GET', '/positions', null, token);
    res.json(r.body);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 注文一覧
app.get('/api/kabu/orders', async (req, res) => {
  try {
    const token = await getKabuToken();
    const r = await kabuReq('GET', '/orders', null, token);
    res.json(r.body);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 発注（mock フラグで実注文 or モック）
app.post('/api/kabu/order', async (req, res) => {
  const { mock, ...orderBody } = req.body;
  if (mock) {
    console.log('[MOCK ORDER]', JSON.stringify(orderBody));
    return res.json({ Result: 0, OrderId: 'MOCK-' + Date.now(), mock: true });
  }
  try {
    const token = await getKabuToken();
    const r = await kabuReq('POST', '/sendorder', orderBody, token);
    res.json(r.body);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── ポートフォリオ CRUD (SQLite) ─────────────────────────────────
// GET /api/portfolio — 全保有銘柄取得
app.get('/api/portfolio', (req, res) => {
  try {
    res.json(db.prepare('SELECT * FROM holdings ORDER BY created_at DESC').all());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/portfolio — 銘柄追加
app.post('/api/portfolio', (req, res) => {
  try {
    const { symbol, name, shares, avg_price } = req.body;
    if (!symbol || shares == null || avg_price == null)
      return res.status(400).json({ error: 'symbol, shares, avg_price は必須です' });
    const r = db.prepare(
      'INSERT INTO holdings (symbol, name, shares, avg_price) VALUES (?, ?, ?, ?)'
    ).run(symbol.toUpperCase(), name || symbol.toUpperCase(), Number(shares), Number(avg_price));
    res.json({ id: r.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/portfolio/:id — 銘柄更新（株数・平均取得額の修正）
app.put('/api/portfolio/:id', (req, res) => {
  try {
    const { shares, avg_price, name } = req.body;
    db.prepare(
      'UPDATE holdings SET shares=?, avg_price=?, name=COALESCE(?,name) WHERE id=?'
    ).run(Number(shares), Number(avg_price), name || null, req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/portfolio/:id — 銘柄削除
app.delete('/api/portfolio/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM holdings WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── LINE Messaging API 通知 ──────────────────────────────────────
function sendLineMessage(text) {
  const token  = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const userId = process.env.LINE_USER_ID;
  if (!token || !userId) return Promise.resolve({ skipped: true });

  const body = JSON.stringify({
    to: userId,
    messages: [{ type: 'text', text }],
  });
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.line.me',
      path: '/v2/bot/message/push',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Content-Length': Buffer.byteLength(body),
      },
    }, (apiRes) => {
      let d = '';
      apiRes.on('data', c => d += c);
      apiRes.on('end', () => {
        if (apiRes.statusCode !== 200)
          console.error('[LINE] 送信失敗:', apiRes.statusCode, d);
        resolve({ status: apiRes.statusCode });
      });
    });
    req.on('error', (e) => { console.error('[LINE] リクエストエラー:', e.message); resolve({ error: e.message }); });
    req.write(body);
    req.end();
  });
}

// 重複通知防止: { "1332.T_stop_2026-03-10" } のSetで当日同一アラートをブロック
const _sentAlerts = new Set();
function alertKey(symbol, type) {
  const d = new Date().toISOString().slice(0, 10);
  return `${symbol}_${type}_${d}`;
}

// 価格アラートチェック（node-cron から呼び出し）
async function checkPriceAlerts() {
  let holdings = [];
  try {
    holdings = db.prepare('SELECT * FROM holdings').all();
  } catch { return; }
  if (holdings.length === 0) return;

  console.log(`[cron] 価格アラートチェック開始 — ${holdings.length}銘柄`);
  for (const h of holdings) {
    let currentPrice;
    try {
      const q = await yahooFinance.quote(h.symbol);
      currentPrice = q.regularMarketPrice;
    } catch (e) {
      console.error(`[cron] ${h.symbol} 価格取得失敗:`, e.message);
      continue;
    }

    const stopPrice   = h.avg_price * 0.95;   // デフォルト -5%
    const profitPrice = h.avg_price * 1.10;   // デフォルト +10%

    if (currentPrice <= stopPrice) {
      const key = alertKey(h.symbol, 'stop');
      if (!_sentAlerts.has(key)) {
        _sentAlerts.add(key);
        const msg = `⚠️ 損切アラート\n${h.symbol}\n現在値: ¥${Math.round(currentPrice).toLocaleString()}\n損切ライン: ¥${Math.round(stopPrice).toLocaleString()}\n（取得単価比 -5%）`;
        await sendLineMessage(msg);
        console.log(`[cron] 損切アラート送信: ${h.symbol}`);
      }
    }
    if (currentPrice >= profitPrice) {
      const key = alertKey(h.symbol, 'profit');
      if (!_sentAlerts.has(key)) {
        _sentAlerts.add(key);
        const msg = `🎯 利確アラート\n${h.symbol}\n現在値: ¥${Math.round(currentPrice).toLocaleString()}\n利確ライン: ¥${Math.round(profitPrice).toLocaleString()}\n（取得単価比 +10%）`;
        await sendLineMessage(msg);
        console.log(`[cron] 利確アラート送信: ${h.symbol}`);
      }
    }
  }
}

// 平日 9:00〜15:30 の30分ごとに実行（サーバーのローカル時間）
cron.schedule('*/30 9-15 * * 1-5', () => {
  checkPriceAlerts().catch(e => console.error('[cron] エラー:', e.message));
});

// LINE 接続テスト用エンドポイント
app.post('/api/line/test', async (req, res) => {
  const token  = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const userId = process.env.LINE_USER_ID;
  if (!token || !userId)
    return res.status(400).json({ error: 'LINE_CHANNEL_ACCESS_TOKEN と LINE_USER_ID を .env に設定してください' });
  try {
    const result = await sendLineMessage('✅ SwingAI LINE通知テスト成功！\n設定が正しく完了しています。');
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── React 静的ファイル配信（本番環境のみ） ──────────────────────
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'build')));
  // SPA フォールバック（/api/* 以外はすべて index.html へ）
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
  });
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`✅ Proxy server running on http://localhost:${PORT}`));
