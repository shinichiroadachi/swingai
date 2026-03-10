import { useState, useCallback, useEffect } from 'react';
import { fetchStockData } from './api';
import { buildChartData, scoreSignal, SIGNAL_MAP } from './indicators';
import KabuOrder from './KabuOrder';

const STORAGE_KEY = 'swingai_portfolio';

// ── 売りシグナルスコア（高いほど売り推奨）──────────────────────────
function sellScore(ind) {
  let s = 0;
  if (ind.rsi > 75) s += 3;
  else if (ind.rsi > 70) s += 2;
  else if (ind.rsi > 65) s += 1;
  if (ind.macdHist < 0) s += 2;
  if (ind.price < ind.sma20) s += 1;
  if (ind.price > ind.bollU) s += 2;
  if (ind.sma20 != null && ind.sma50 != null && ind.sma20 < ind.sma50) s += 1;
  return s; // 0–9
}

const SELL_MAP = [
  { min: 7, label: '🔴 強く売り推奨', color: '#f85149' },
  { min: 5, label: '🟠 やや売り推奨', color: '#ff9944' },
  { min: 3, label: '🟡 様子見',       color: '#ffd700' },
  { min: 0, label: '🟢 保有継続',     color: '#3fb950' },
];

// ── 空売りスコア ───────────────────────────────────────────────────
function shortScore(ind) {
  let s = 0;
  if (ind.rsi > 75) s += 3;
  else if (ind.rsi > 70) s += 1;
  if (ind.price > ind.bollU) s += 3;
  if (ind.macdHist < 0 && ind.price < ind.sma20) s += 2;
  if (ind.price < ind.sma20 && ind.sma20 < ind.sma50) s += 2;
  return s; // 0–10
}

const SHORT_MAP = [
  { min: 6, label: '⚡ 空売り好機',   color: '#d2a8ff' },
  { min: 3, label: '🔵 空売り検討',   color: '#58a6ff' },
  { min: 0, label: '—',              color: '#484f58' },
];

// ── AI アドバイス（売り/空売り特化） ───────────────────────────────
async function fetchSellAdvice({ symbol, name, ind, avgPrice, shares, currency }) {
  const isJPY = currency === 'JPY';
  const pl = ((ind.price - avgPrice) / avgPrice * 100).toFixed(2);
  const plAmt = Math.round((ind.price - avgPrice) * shares);
  const prompt = `あなたはスイングトレードの専門アナリストです。以下の保有銘柄について「売り時」と「空売り機会」の観点で初心者向けにアドバイスをください。

銘柄: ${name} (${symbol})
現在価格: ${isJPY ? '¥' : '$'}${ind.price.toLocaleString()}
取得単価: ${isJPY ? '¥' : '$'}${avgPrice.toLocaleString()}
保有株数: ${shares}株
含み損益: ${plAmt >= 0 ? '+' : ''}${isJPY ? '¥' : '$'}${plAmt.toLocaleString()} (${pl}%)

【テクニカル指標】
RSI(14): ${ind.rsi?.toFixed(1)} ${ind.rsi > 70 ? '→ 買われ過ぎ⚠️' : ind.rsi < 30 ? '→ 売られ過ぎ' : '→ 中立'}
MACD: ${ind.macdHist > 0 ? '強気（ヒストグラム正）' : '弱気（ヒストグラム負）'}
SMA20比: 価格は${ind.price > ind.sma20 ? 'SMA20の上（強気）' : 'SMA20の下（弱気）'}
ボリンジャー: 価格は${ind.price > ind.bollU ? '上限超え（過熱⚠️）' : ind.price < ind.bollL ? '下限割れ' : 'バンド内'}

以下の形式で簡潔に回答:
**【売り判断】** 今すぐ売り / 一部利確 / 保有継続 / 損切り検討 のどれか
**【推奨売値】** 具体的な価格
**【理由】** 2文以内
**【空売り機会】** あり/なし + 理由1文（なしの場合は「現時点では空売り不適」と記載）

※投資助言ではなく参考情報です。`;

  const res = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: prompt }] }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.content?.map(c => c.text || '').join('\n') || '分析できませんでした';
}

// ── Holdings storage helpers ─────────────────────────────────────
function loadHoldings() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch { return []; }
}
function saveHoldings(h) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(h));
}

// ── Portfolio component ──────────────────────────────────────────
export default function Portfolio({ kabuStatus }) {
  const [holdings, setHoldings] = useState(loadHoldings);
  const [form, setForm] = useState({ symbol: '', shares: '', avgPrice: '' });
  const [analyzing, setAnalyzing] = useState({});   // { [id]: 'loading' | 'done' | 'error' }
  const [indMap, setIndMap]   = useState({});        // { [id]: indData }
  const [aiMap, setAiMap]     = useState({});        // { [id]: text }
  const [aiLoading, setAiLoading] = useState({});    // { [id]: bool }
  const [formErr, setFormErr] = useState('');
  const [orderTarget, setOrderTarget] = useState(null); // { symbol, name, side, price, suggestedQty, isJPY }

  useEffect(() => { saveHoldings(holdings); }, [holdings]);

  const addHolding = () => {
    const sym = form.symbol.trim().toUpperCase();
    const shares = Number(form.shares);
    const avgPrice = Number(form.avgPrice);
    if (!sym) return setFormErr('銘柄コードを入力してください');
    if (!shares || shares <= 0) return setFormErr('保有株数を入力してください');
    if (!avgPrice || avgPrice <= 0) return setFormErr('取得単価を入力してください');
    const id = `${sym}_${Date.now()}`;
    setHoldings(prev => [...prev, { id, symbol: sym, shares, avgPrice }]);
    setForm({ symbol: '', shares: '', avgPrice: '' });
    setFormErr('');
  };

  const removeHolding = (id) => {
    setHoldings(prev => prev.filter(h => h.id !== id));
    setIndMap(prev => { const n = { ...prev }; delete n[id]; return n; });
    setAiMap(prev => { const n = { ...prev }; delete n[id]; return n; });
  };

  const analyzeHolding = useCallback(async (holding) => {
    const { id, symbol } = holding;
    setAnalyzing(prev => ({ ...prev, [id]: 'loading' }));
    try {
      const { prices, currentPrice, currency, name } = await fetchStockData(symbol, '3mo');
      const cd = buildChartData(prices);
      const last = cd[cd.length - 1];
      const ind = {
        price: currentPrice || last.close,
        sma20: last.sma20, sma50: last.sma50,
        rsi: last.rsi, macdHist: last.macdHist,
        bollU: last.bollU, bollM: last.bollM, bollL: last.bollL,
      };
      setHoldings(prev => prev.map(h => h.id === id ? { ...h, name, currency } : h));
      setIndMap(prev => ({ ...prev, [id]: ind }));
      setAnalyzing(prev => ({ ...prev, [id]: 'done' }));

      // AI advice
      setAiLoading(prev => ({ ...prev, [id]: true }));
      try {
        const advice = await fetchSellAdvice({
          symbol, name, ind,
          avgPrice: holding.avgPrice,
          shares: holding.shares,
          currency,
        });
        setAiMap(prev => ({ ...prev, [id]: advice }));
      } catch (e) {
        setAiMap(prev => ({ ...prev, [id]: `⚠️ ${e.message}` }));
      }
      setAiLoading(prev => ({ ...prev, [id]: false }));
    } catch (e) {
      setAnalyzing(prev => ({ ...prev, [id]: 'error' }));
    }
  }, []);

  const analyzeAll = () => holdings.forEach(h => analyzeHolding(h));

  return (
    <div className="portfolio">
      {/* Add form */}
      <div className="card">
        <div className="chart-title">💼 保有株管理 — 売り時・空売りアドバイス</div>
        <div className="port-form">
          <input
            className="text-input"
            placeholder="銘柄コード (例: 7203.T, AAPL)"
            value={form.symbol}
            onChange={e => setForm(f => ({ ...f, symbol: e.target.value.toUpperCase() }))}
            onKeyDown={e => e.key === 'Enter' && addHolding()}
            style={{ flex: '2 1 150px' }}
          />
          <input
            className="number-input"
            type="number"
            placeholder="保有株数"
            value={form.shares}
            onChange={e => setForm(f => ({ ...f, shares: e.target.value }))}
            style={{ flex: '1 1 90px' }}
          />
          <input
            className="number-input"
            type="number"
            placeholder="取得単価"
            value={form.avgPrice}
            onChange={e => setForm(f => ({ ...f, avgPrice: e.target.value }))}
            style={{ flex: '1 1 100px' }}
          />
          <button className="analyze-btn" onClick={addHolding}>追加 +</button>
          {holdings.length > 0 && (
            <button className="analyze-btn" onClick={analyzeAll} style={{ background: '#1f6feb' }}>
              全て分析 →
            </button>
          )}
        </div>
        {formErr && <div style={{ color: '#f85149', fontSize: 11, marginTop: 6 }}>{formErr}</div>}
      </div>

      {holdings.length === 0 && (
        <div className="card no-result">
          保有している銘柄を追加してください。<br />
          売り時・空売りのAIアドバイスを自動で生成します。
        </div>
      )}

      {/* Holding cards */}
      {holdings.map(h => {
        const ind = indMap[h.id];
        const status = analyzing[h.id];
        const isJPY = h.currency === 'JPY';
        const fmt = v => v == null ? '—' : (isJPY ? `¥${Math.round(v).toLocaleString()}` : `$${v.toFixed(2)}`);
        const pl = ind ? ((ind.price - h.avgPrice) / h.avgPrice * 100) : null;
        const plAmt = ind ? Math.round((ind.price - h.avgPrice) * h.shares) : null;
        const ss = ind ? sellScore(ind) : null;
        const sellSig = ss != null ? SELL_MAP.find(s => ss >= s.min) : null;
        const sh = ind ? shortScore(ind) : null;
        const shortSig = sh != null ? SHORT_MAP.find(s => sh >= s.min) : null;
        const buySig = ind ? (SIGNAL_MAP.find(s => scoreSignal(ind) >= s.min) || SIGNAL_MAP.at(-1)) : null;

        return (
          <div key={h.id} className="card port-card">
            {/* Header row */}
            <div className="port-header">
              <div>
                <div className="port-symbol">{h.symbol}</div>
                <div className="port-name">{h.name || '...'}</div>
              </div>
              <div className="port-header-right">
                {ind && (
                  <div className="port-price">{fmt(ind.price)}</div>
                )}
                {pl != null && (
                  <div className={`port-pl ${pl >= 0 ? 'up' : 'down'}`}>
                    {pl >= 0 ? '▲' : '▼'} {Math.abs(pl).toFixed(2)}%
                    ({pl >= 0 ? '+' : ''}{isJPY ? '¥' : '$'}{Math.abs(plAmt).toLocaleString()})
                  </div>
                )}
                <div className="port-actions">
                  <button
                    className="range-btn active"
                    onClick={() => analyzeHolding(h)}
                    disabled={status === 'loading'}
                  >
                    {status === 'loading' ? '分析中...' : '再分析'}
                  </button>
                  {ind && (
                    <button
                      className="order-btn sell"
                      onClick={() => setOrderTarget({
                        symbol: h.symbol,
                        name: h.name || h.symbol,
                        side: 'sell',
                        price: ind.price,
                        suggestedQty: h.shares,
                        isJPY: h.currency === 'JPY',
                      })}
                    >
                      売り注文
                    </button>
                  )}
                  <button className="stop-btn" onClick={() => removeHolding(h.id)}>削除</button>
                </div>
              </div>
            </div>

            {/* Holdings info */}
            <div className="port-info">
              <span>保有 {h.shares.toLocaleString()}株</span>
              <span>取得単価 {isJPY ? '¥' : '$'}{Number(h.avgPrice).toLocaleString()}</span>
              {ind && <span>評価額 {isJPY ? '¥' : '$'}{Math.round(ind.price * h.shares).toLocaleString()}</span>}
            </div>

            {status === 'error' && (
              <div style={{ color: '#f85149', fontSize: 12, marginTop: 8 }}>
                ⚠️ データ取得に失敗しました。銘柄コードを確認してください。
              </div>
            )}

            {status === 'loading' && (
              <div style={{ color: '#484f58', fontSize: 12, marginTop: 8 }} className="blink">
                ⏳ データ取得中...
              </div>
            )}

            {ind && (
              <div className="port-signals">
                {/* Buy signal */}
                <div className="psig-card">
                  <div className="psig-label">買いシグナル</div>
                  <div className="psig-val" style={{ color: buySig?.color }}>{buySig?.label}</div>
                </div>
                {/* Sell signal */}
                <div className="psig-card">
                  <div className="psig-label">売りシグナル</div>
                  <div className="psig-val" style={{ color: sellSig?.color }}>{sellSig?.label}</div>
                </div>
                {/* Short signal */}
                <div className="psig-card">
                  <div className="psig-label">空売り判断</div>
                  <div className="psig-val" style={{ color: shortSig?.color }}>{shortSig?.label}</div>
                </div>
                {/* RSI */}
                <div className="psig-card">
                  <div className="psig-label">RSI(14)</div>
                  <div className="psig-val" style={{ color: ind.rsi > 70 ? '#f85149' : ind.rsi < 30 ? '#3fb950' : '#d2a8ff' }}>
                    {ind.rsi?.toFixed(1)}
                  </div>
                </div>
                {/* MACD */}
                <div className="psig-card">
                  <div className="psig-label">MACD</div>
                  <div className="psig-val" style={{ color: ind.macdHist > 0 ? '#3fb950' : '#f85149' }}>
                    {ind.macdHist > 0 ? '↑ 強気' : '↓ 弱気'}
                  </div>
                </div>
                {/* BB */}
                <div className="psig-card">
                  <div className="psig-label">BB位置</div>
                  <div className="psig-val" style={{ color: ind.price > ind.bollU ? '#f85149' : ind.price < ind.bollL ? '#3fb950' : '#8b949e' }}>
                    {ind.price > ind.bollU ? '上限超え' : ind.price < ind.bollL ? '下限割れ' : 'バンド内'}
                  </div>
                </div>
              </div>
            )}

            {/* AI advice */}
            {(aiMap[h.id] || aiLoading[h.id]) && (
              <div className="ai-box" style={{ marginTop: 12 }}>
                {aiLoading[h.id]
                  ? <span className="ai-loading">⏳ AIが売り時・空売りを分析中...</span>
                  : <pre className="ai-text">{aiMap[h.id]}</pre>
                }
              </div>
            )}
          </div>
        );
      })}

      {orderTarget && (
        <KabuOrder
          order={orderTarget}
          kabuStatus={kabuStatus}
          onClose={() => setOrderTarget(null)}
          onDone={() => setOrderTarget(null)}
        />
      )}
    </div>
  );
}
