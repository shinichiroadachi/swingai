require('dotenv').config();
const express = require('express');
const cors = require('cors');
const https = require('https');
const http  = require('http');
const YahooFinanceLib = require('yahoo-finance2').default;
const yahooFinance = new YahooFinanceLib({ suppressNotices: ['yahooSurvey'] });

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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`✅ Proxy server running on http://localhost:${PORT}`));
