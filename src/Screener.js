import { useState, useRef, useCallback, useEffect } from 'react';
import { NIKKEI225 } from './nikkei225';
import { SP500 } from './sp500';
import { fetchStockData } from './api';
import { buildChartData, scoreSignal, SIGNAL_MAP } from './indicators';
import KabuOrder from './KabuOrder';

const BATCH_SIZE = 3;
const BATCH_DELAY = 700; // ms between batches to avoid rate limiting

const MARKETS = [
  { id: 'nikkei', label: '🇯🇵 日経225', stocks: NIKKEI225, currency: 'JPY' },
  { id: 'sp500',  label: '🇺🇸 S&P500',  stocks: SP500,     currency: 'USD' },
];

const AUTO_INTERVALS = [
  { value: 30,  label: '30分' },
  { value: 60,  label: '1時間' },
  { value: 180, label: '3時間' },
];

export default function Screener({ kabuStatus }) {
  const [market, setMarket] = useState('nikkei');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [errors, setErrors] = useState(0);
  const [results, setResults] = useState([]);
  const [done, setDone] = useState(false);
  const [minScore, setMinScore] = useState(5);
  const [orderTarget, setOrderTarget] = useState(null);

  // 自動スキャン
  const [autoScan, setAutoScan] = useState(false);
  const [autoInterval, setAutoInterval] = useState(60); // 分
  const [nextScanAt, setNextScanAt] = useState(null);
  const [lastScanAt, setLastScanAt] = useState(null);
  const [countdown, setCountdown] = useState('');

  const abortRef = useRef(false);
  const autoTimerRef = useRef(null);
  const prevSymbolsRef = useRef(new Set()); // 前回スキャンでシグナルが出た銘柄

  const requestNotifPermission = async () => {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'default') {
      await Notification.requestPermission();
    }
  };

  const isUSD = market === 'sp500';

  const notify = (name, sig, price) => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      const priceStr = isUSD
        ? `$${price.toFixed(2)}`
        : `¥${Math.round(price).toLocaleString()}`;
      new Notification(`${sig.label} 買いシグナル: ${name}`, {
        body: `${priceStr} — スコア ${sig.min >= 5 ? '5' : '4'}/5`,
        icon: '/favicon.ico',
      });
    }
  };

  const activeMarket = MARKETS.find(m => m.id === market);

  const scan = useCallback(async (isAuto = false) => {
    setRunning(true);
    setDone(false);
    setResults([]);
    setProgress(0);
    setErrors(0);
    abortRef.current = false;

    if (!isAuto) await requestNotifPermission();

    const stocks = activeMarket.stocks;
    const newResults = [];

    for (let i = 0; i < stocks.length; i += BATCH_SIZE) {
      if (abortRef.current) break;

      const batch = stocks.slice(i, i + BATCH_SIZE);

      await Promise.allSettled(batch.map(async (stock) => {
        try {
          const { prices, currentPrice } = await fetchStockData(stock.symbol, '3mo');
          const cd = buildChartData(prices);
          const last = cd[cd.length - 1];
          const ind = {
            price:      currentPrice || last.close,
            sma20:      last.sma20,      sma50:     last.sma50,
            rsi:        last.rsi,
            macdHist:   last.macdHist,
            bollU:      last.bollU,      bollM:     last.bollM,   bollL: last.bollL,
            stochK:     last.stochK,     stochD:    last.stochD,
            ichTenkan:  last.ichTenkan,  ichKijun:  last.ichKijun,
            ichSenkouA: last.ichSenkouA, ichSenkouB: last.ichSenkouB,
          };
          const score = scoreSignal(ind);

          if (score >= minScore) {
            const sig = SIGNAL_MAP.find(s => score >= s.min) || SIGNAL_MAP.at(-1);
            const isNew = !prevSymbolsRef.current.has(stock.symbol);
            newResults.push({ ...stock, score, ind, sig, isNew });
            newResults.sort((a, b) => b.score - a.score || b.ind.rsi - a.ind.rsi);
            setResults([...newResults]);
            // 自動スキャン時は新規シグナルのみ通知、手動時は全件通知
            if (!isAuto || isNew) notify(stock.name, sig, ind.price);
          }
        } catch {
          setErrors(prev => prev + 1);
        }
      }));

      setProgress(Math.min(i + BATCH_SIZE, stocks.length));

      if (i + BATCH_SIZE < stocks.length && !abortRef.current) {
        await new Promise(r => setTimeout(r, BATCH_DELAY));
      }
    }

    prevSymbolsRef.current = new Set(newResults.map(r => r.symbol));
    setLastScanAt(new Date());
    setRunning(false);
    setDone(true);
  }, [minScore, activeMarket]); // eslint-disable-line

  const stop = () => { abortRef.current = true; };

  // 自動スキャン: 最新の scan 関数を ref で保持（stale closure 防止）
  const scanRef = useRef(scan);
  useEffect(() => { scanRef.current = scan; }, [scan]);

  useEffect(() => {
    if (!autoScan) {
      clearTimeout(autoTimerRef.current);
      setNextScanAt(null);
      setCountdown('');
      return;
    }

    const schedule = () => {
      const ms = autoInterval * 60 * 1000;
      setNextScanAt(new Date(Date.now() + ms));
      autoTimerRef.current = setTimeout(async () => {
        await scanRef.current(true);
        schedule();
      }, ms);
    };

    schedule();
    return () => clearTimeout(autoTimerRef.current);
  }, [autoScan, autoInterval]);

  // カウントダウン表示（1秒ごと更新）
  useEffect(() => {
    if (!autoScan || !nextScanAt) { setCountdown(''); return; }
    const timer = setInterval(() => {
      const diff = nextScanAt - Date.now();
      if (diff <= 0) {
        setCountdown('まもなく...');
      } else {
        const m = Math.floor(diff / 60000);
        const s = Math.floor((diff % 60000) / 1000);
        setCountdown(`${m}:${s.toString().padStart(2, '0')}`);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [autoScan, nextScanAt]);

  const pct = Math.round((progress / (activeMarket?.stocks.length || 1)) * 100);

  const fmt = (v, usd) => {
    if (v == null) return '—';
    return usd ? `$${v.toFixed(2)}` : `¥${Math.round(v).toLocaleString()}`;
  };

  return (
    <div className="screener">
      {/* Config bar */}
      <div className="card screener-config">
        <div className="screener-config-row">
          <div>
            <div className="chart-title">🔍 全銘柄スキャン</div>
            <div className="screener-desc">
              自動分析して買いシグナルが出ている銘柄を抽出します
            </div>
            {/* Market selector */}
            <div className="market-btns" style={{ marginTop: 12 }}>
              {MARKETS.map(m => (
                <button
                  key={m.id}
                  className={`range-btn ${market === m.id ? 'active' : ''}`}
                  onClick={() => { setMarket(m.id); setResults([]); setDone(false); setProgress(0); prevSymbolsRef.current = new Set(); }}
                  disabled={running}
                >
                  {m.label} ({m.stocks.length}銘柄)
                </button>
              ))}
            </div>
          </div>
          <div className="screener-controls">
            <label className="score-label">
              <span className="label-text">最低スコア</span>
              <select
                className="score-select"
                value={minScore}
                onChange={e => setMinScore(Number(e.target.value))}
                disabled={running}
              >
                <option value={7}>7〜8 — 強気買いのみ</option>
                <option value={5}>5〜6 — やや買い以上</option>
                <option value={3}>3〜4 — 中立以上</option>
              </select>
            </label>
            {!running ? (
              <button className="analyze-btn" onClick={() => scan(false)}>
                今すぐスキャン →
              </button>
            ) : (
              <button className="stop-btn" onClick={stop}>
                中止
              </button>
            )}
          </div>
        </div>

        {/* 自動スキャン設定 */}
        <div className="auto-scan-row">
          <label className="auto-scan-toggle">
            <input
              type="checkbox"
              checked={autoScan}
              onChange={e => setAutoScan(e.target.checked)}
              disabled={running}
            />
            <span>⏱ 自動スキャン</span>
          </label>
          {autoScan && (
            <>
              <select
                className="score-select"
                value={autoInterval}
                onChange={e => setAutoInterval(Number(e.target.value))}
                disabled={running}
              >
                {AUTO_INTERVALS.map(i => (
                  <option key={i.value} value={i.value}>{i.label}ごと</option>
                ))}
              </select>
              <div className="auto-scan-info">
                {running ? (
                  <span className="blink">スキャン実行中...</span>
                ) : (
                  <>
                    <span>次回: <strong>{countdown}</strong></span>
                    {lastScanAt && (
                      <span style={{ marginLeft: 12 }}>
                        最終: {lastScanAt.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })} ✅
                      </span>
                    )}
                  </>
                )}
              </div>
            </>
          )}
          {!autoScan && lastScanAt && (
            <span className="auto-scan-info" style={{ marginLeft: 8 }}>
              最終スキャン: {lastScanAt.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>

        {/* Progress bar */}
        {(running || done) && (
          <div className="progress-wrap">
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="progress-info">
              {running
                ? `スキャン中... ${progress} / ${activeMarket?.stocks.length} 銘柄 (${pct}%)`
                : `完了 — ${progress} 銘柄スキャン済み`}
              {errors > 0 && <span className="err-count"> · {errors}件取得失敗</span>}
            </div>
          </div>
        )}
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="card">
          <div className="chart-title">
            📋 買いシグナル銘柄 — {results.length}件
            {autoScan && results.filter(r => r.isNew).length > 0 && (
              <span className="new-count"> · 🆕 新規 {results.filter(r => r.isNew).length}件</span>
            )}
            {running && <span className="blink"> (スキャン中...)</span>}
          </div>
          <p style={{ color: '#8b949e', fontSize: 11, margin: '0 0 8px 0' }}>
            ※スコアは技術指標に基づく参考値です。投資助言・投資勧誘ではありません。投資判断はご自身の責任で行ってください。
          </p>
          <div className="result-table-wrap">
            <table className="result-table">
              <thead>
                <tr>
                  <th>銘柄</th>
                  <th>現在価格</th>
                  <th>シグナル</th>
                  <th>RSI</th>
                  <th>MACD</th>
                  <th>SMA20比</th>
                  <th>仮損切 (-5%)</th>
                  <th>仮利確 (+10%)</th>
                  <th>発注</th>
                </tr>
              </thead>
              <tbody>
                {results.map(r => (
                  <tr key={r.symbol} className={`result-row ${r.isNew && autoScan ? 'new-signal-row' : ''}`}>
                    <td>
                      <div className="r-symbol">
                        {r.symbol.replace('.T', '')}
                        {r.isNew && autoScan && <span className="new-badge">NEW</span>}
                      </div>
                      <div className="r-name">{r.name}</div>
                    </td>
                    <td className="r-price">{fmt(r.ind.price, isUSD)}</td>
                    <td>
                      <span className="sig-badge" style={{ color: r.sig.color, borderColor: r.sig.color }}>
                        {r.sig.label}
                      </span>
                    </td>
                    <td style={{ color: r.ind.rsi > 70 ? '#f85149' : r.ind.rsi < 30 ? '#3fb950' : '#d2a8ff' }}>
                      {r.ind.rsi?.toFixed(1)}
                    </td>
                    <td style={{ color: r.ind.macdHist > 0 ? '#3fb950' : '#f85149' }}>
                      {r.ind.macdHist > 0 ? '↑ 強気' : '↓ 弱気'}
                    </td>
                    <td style={{ color: r.ind.price > r.ind.sma20 ? '#3fb950' : '#f85149' }}>
                      {r.ind.price > r.ind.sma20 ? '↑ 上方' : '↓ 下方'}
                    </td>
                    <td className="r-loss">{fmt(r.ind.price * 0.95, isUSD)}</td>
                    <td className="r-gain">{fmt(r.ind.price * 1.10, isUSD)}</td>
                    <td>
                      <button
                        className="order-btn buy"
                        onClick={() => setOrderTarget({
                          symbol: r.symbol, name: r.name,
                          side: 'buy', price: r.ind.price,
                          suggestedQty: isUSD ? 1 : 100,
                          isJPY: !isUSD,
                        })}
                      >
                        買い注文
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {done && results.length === 0 && (
        <div className="card no-result">
          スコア{minScore}以上の銘柄は見つかりませんでした。最低スコアを下げて再スキャンしてください。
        </div>
      )}

      {!running && !done && (
        <div className="card no-result">
          「今すぐスキャン」を押すか、自動スキャンをONにしてください。<br />
          ブラウザの通知を許可すると、買いシグナル発生時に通知が届きます。
        </div>
      )}

      {/* 注文モーダル */}
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
