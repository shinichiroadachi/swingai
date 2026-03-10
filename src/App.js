import { useState, useCallback, useEffect } from 'react';
import { fetchKabuStatus } from './kabuApi';
import {
  ComposedChart, LineChart, Line, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine, CartesianGrid,
} from 'recharts';
import { fetchStockData, fetchAIAdvice, fetchFundamentals } from './api';
import { buildChartData, scoreSignal, SIGNAL_MAP } from './indicators';
import Screener from './Screener';
import Portfolio from './Portfolio';
import './App.css';

// ── Presets ────────────────────────────────────────────────────────
const PRESETS = [
  { symbol: '7203.T',  label: 'トヨタ',      flag: '🇯🇵' },
  { symbol: '6758.T',  label: 'ソニー',       flag: '🇯🇵' },
  { symbol: '9984.T',  label: 'ソフトバンクG', flag: '🇯🇵' },
  { symbol: '4063.T',  label: '信越化学',     flag: '🇯🇵' },
  { symbol: 'AAPL',    label: 'Apple',        flag: '🇺🇸' },
  { symbol: 'NVDA',    label: 'NVIDIA',       flag: '🇺🇸' },
  { symbol: 'TSLA',    label: 'Tesla',        flag: '🇺🇸' },
  { symbol: 'MSFT',    label: 'Microsoft',    flag: '🇺🇸' },
  { symbol: 'BTC-USD', label: 'Bitcoin',      flag: '₿'  },
  { symbol: 'ETH-USD', label: 'Ethereum',     flag: 'Ξ'  },
];

// ── Custom tooltip ─────────────────────────────────────────────────
const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="tooltip-date">{label}</div>
      {payload.map((p, i) => (
        p.value != null && (
          <div key={i} style={{ color: p.color }}>
            {p.name}: {typeof p.value === 'number' ? p.value.toFixed(2) : p.value}
          </div>
        )
      ))}
    </div>
  );
};

// ── Indicator card ─────────────────────────────────────────────────
const IndCard = ({ label, value, color, sub }) => (
  <div className="ind-card">
    <div className="ind-label">{label}</div>
    <div className="ind-value" style={{ color }}>{value ?? '—'}</div>
    {sub && <div className="ind-sub">{sub}</div>}
  </div>
);

// ── Main App ───────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState('analyze'); // 'analyze' | 'screener'
  const [kabuStatus, setKabuStatus] = useState({ connected: false, mock: true });

  useEffect(() => {
    fetchKabuStatus().then(setKabuStatus).catch(() => {});
  }, []);
  const [symbolInput, setSymbolInput] = useState('');
  const [budget, setBudget] = useState(300000);
  const [range, setRange] = useState('3mo');

  const [status, setStatus] = useState('idle'); // idle | loading | done | error
  const [errMsg, setErrMsg] = useState('');

  const [chartData, setChartData] = useState([]);
  const [stockInfo, setStockInfo] = useState(null);   // { name, currency, symbol }
  const [ind, setInd] = useState(null);
  const [fundamentals, setFundamentals] = useState(null);
  const [aiText, setAiText] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  // ATRベース損切・利確 倍率スライダー
  const [atrLossMult, setAtrLossMult] = useState(1.5);
  const [atrGainMult, setAtrGainMult] = useState(3.0);

  const doAnalyze = useCallback(async (sym) => {
    if (!sym) return;
    setStatus('loading');
    setErrMsg('');
    setAiText('');
    setInd(null);
    setChartData([]);

    try {
      const { prices, currency, name, currentPrice } = await fetchStockData(sym, range);
      const cd = buildChartData(prices);
      setChartData(cd);

      const last = cd[cd.length - 1];
      const indData = {
        price:     currentPrice || last.close,
        sma20:     last.sma20,     sma50:     last.sma50,
        rsi:       last.rsi,
        macdHist:  last.macdHist,  macdLine:  last.macdLine,  macdSig: last.macdSig,
        bollU:     last.bollU,     bollM:     last.bollM,     bollL:   last.bollL,
        stochK:    last.stochK,    stochD:    last.stochD,
        ichTenkan: last.ichTenkan, ichKijun:  last.ichKijun,
        ichSenkouA:last.ichSenkouA,ichSenkouB:last.ichSenkouB,
      };
      setInd(indData);
      setFundamentals(null);
      setStockInfo({ name, currency, symbol: sym });
      setStatus('done');

      // ファンダメンタル + AI advice (非同期、並列)
      setAiLoading(true);
      const [fund] = await Promise.allSettled([fetchFundamentals(sym)]);
      const fundData = fund.status === 'fulfilled' ? fund.value : null;
      setFundamentals(fundData);
      try {
        const advice = await fetchAIAdvice({ symbol: sym, name, ind: indData, budget, currency, fundamentals: fundData });
        setAiText(advice);
      } catch (e) {
        setAiText(`⚠️ AIアドバイス取得エラー: ${e.message}`);
      }
      setAiLoading(false);
    } catch (e) {
      setStatus('error');
      setErrMsg(e.message || 'データ取得に失敗しました');
    }
  }, [range, budget]);

  const handleAnalyze = () => doAnalyze(symbolInput.trim().toUpperCase());

  // derived
  const isJPY = stockInfo?.currency === 'JPY';
  const lotSize = isJPY ? 100 : 1;
  const maxShares = ind ? Math.floor(budget / ind.price / lotSize) * lotSize : 0;
  const totalCost = maxShares * (ind?.price || 0);

  const signalScore = ind ? scoreSignal(ind) : 0;
  const sig = SIGNAL_MAP.find(s => signalScore >= s.min) || SIGNAL_MAP.at(-1);

  const priceChangePct = chartData.length > 1
    ? ((chartData.at(-1).close - chartData[0].close) / chartData[0].close * 100).toFixed(2)
    : null;

  const fmt = (v, decimals = 2) => {
    if (v == null) return '—';
    return isJPY
      ? `¥${Math.round(v).toLocaleString()}`
      : `$${v.toFixed(decimals)}`;
  };

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-left">
          <span className="logo">SwingAI</span>
          <span className="header-sub">スイングトレード分析ツール</span>
          <span className={`kabu-badge ${kabuStatus.connected ? 'connected' : 'disconnected'}`}>
            {kabuStatus.connected ? '🟢 kabu+ 接続中' : '⚫ kabu+ 未接続'}
          </span>
        </div>
        <nav className="tab-nav">
          <button className={`tab-btn ${tab === 'analyze' ? 'active' : ''}`} onClick={() => setTab('analyze')}>
            📊 個別分析
          </button>
          <button className={`tab-btn ${tab === 'screener' ? 'active' : ''}`} onClick={() => setTab('screener')}>
            🔍 全銘柄スキャン
          </button>
          <button className={`tab-btn ${tab === 'portfolio' ? 'active' : ''}`} onClick={() => setTab('portfolio')}>
            💼 保有株
          </button>
        </nav>
      </header>

      <main className="main">
        {tab === 'screener' && <Screener kabuStatus={kabuStatus} />}
        {tab === 'portfolio' && <Portfolio kabuStatus={kabuStatus} />}
        {tab === 'analyze' && (
        <>
        {/* Controls */}
        <section className="card">
          {/* Presets */}
          <div className="presets">
            {PRESETS.map(p => (
              <button
                key={p.symbol}
                className={`preset-btn ${symbolInput === p.symbol ? 'active' : ''}`}
                onClick={() => setSymbolInput(p.symbol)}
              >
                <span>{p.flag}</span>
                <span>{p.label}</span>
              </button>
            ))}
          </div>

          {/* Input row */}
          <div className="input-row">
            <input
              className="text-input"
              placeholder="銘柄コード (例: 7203.T, AAPL, BTC-USD)"
              value={symbolInput}
              onChange={e => setSymbolInput(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Enter' && handleAnalyze()}
            />
            <label className="budget-label">
              <span className="label-text">予算 (円)</span>
              <input
                className="number-input"
                type="number"
                value={budget}
                step={10000}
                onChange={e => setBudget(Number(e.target.value))}
              />
            </label>
            <div className="range-btns">
              {['1mo', '3mo', '6mo'].map(r => (
                <button
                  key={r}
                  className={`range-btn ${range === r ? 'active' : ''}`}
                  onClick={() => setRange(r)}
                >{r}</button>
              ))}
            </div>
            <button
              className="analyze-btn"
              onClick={handleAnalyze}
              disabled={!symbolInput || status === 'loading'}
            >
              {status === 'loading' ? '取得中...' : '分析する →'}
            </button>
          </div>
        </section>

        {/* Error */}
        {status === 'error' && (
          <div className="error-box">⚠️ {errMsg}</div>
        )}

        {/* Loading */}
        {status === 'loading' && (
          <div className="loading-box">
            <div className="spinner" />
            Yahoo Finance からリアルタイムデータを取得中...
          </div>
        )}

        {status === 'done' && ind && (
          <>
            {/* Stock header */}
            <section className="card stock-header">
              <div>
                <div className="stock-name">{stockInfo.name}</div>
                <div className="stock-meta">{stockInfo.symbol} · {stockInfo.currency}</div>
              </div>
              <div className="price-block">
                <div className="current-price">{fmt(ind.price)}</div>
                {priceChangePct != null && (
                  <div className={`price-change ${priceChangePct >= 0 ? 'up' : 'down'}`}>
                    {priceChangePct >= 0 ? '▲' : '▼'} {Math.abs(priceChangePct)}% ({range})
                  </div>
                )}
              </div>
              <div>
                <div className="sig-label" style={{ color: sig.color, borderColor: sig.color }}>
                  {sig.label}
                </div>
                <div className="sig-sub">{signalScore}/8 指標が強気</div>
              </div>
            </section>

            {/* Price Chart + 一目均衡表 */}
            <section className="card">
              <div className="chart-title">価格チャート + BB + MA + 一目均衡表</div>
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                  <XAxis dataKey="date" tick={{ fill: '#484f58', fontSize: 9 }} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fill: '#484f58', fontSize: 9 }} tickLine={false} axisLine={false} width={60}
                    tickFormatter={v => isJPY ? `¥${v.toFixed(0)}` : `$${v.toFixed(1)}`} domain={['auto', 'auto']} />
                  <Tooltip content={<ChartTooltip />} />
                  <Line dataKey="bollU"      stroke="#2d3748" strokeWidth={1} dot={false} name="BB上限" />
                  <Line dataKey="bollM"      stroke="#374151" strokeWidth={1} strokeDasharray="4 2" dot={false} name="BB中央" />
                  <Line dataKey="bollL"      stroke="#2d3748" strokeWidth={1} dot={false} name="BB下限" />
                  <Line dataKey="ichSenkouA" stroke="#6e40c955" strokeWidth={1} dot={false} name="先行A" strokeDasharray="3 2" />
                  <Line dataKey="ichSenkouB" stroke="#58a6ff44" strokeWidth={1} dot={false} name="先行B" strokeDasharray="3 2" />
                  <Line dataKey="ichKijun"   stroke="#f0883e" strokeWidth={1.5} dot={false} name="基準線" />
                  <Line dataKey="ichTenkan"  stroke="#ff6b9d" strokeWidth={1.5} dot={false} name="転換線" />
                  <Line dataKey="sma50"      stroke="#ffd700" strokeWidth={1.5} dot={false} name="SMA50" />
                  <Line dataKey="sma20"      stroke="#58a6ff" strokeWidth={1.5} dot={false} name="SMA20" />
                  <Line dataKey="close"      stroke="#3fb950" strokeWidth={2} dot={false} name="終値" />
                </ComposedChart>
              </ResponsiveContainer>
            </section>

            {/* Volume Chart */}
            <section className="card">
              <div className="chart-title">出来高 (Volume)</div>
              <ResponsiveContainer width="100%" height={70}>
                <ComposedChart data={chartData} margin={{ top: 2, right: 8, left: 0, bottom: 0 }}>
                  <XAxis dataKey="date" hide />
                  <YAxis tick={{ fill: '#484f58', fontSize: 9 }} tickLine={false} axisLine={false} width={60}
                    tickFormatter={v => v >= 1e6 ? `${(v/1e6).toFixed(0)}M` : v >= 1e3 ? `${(v/1e3).toFixed(0)}K` : v} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="volume" fill="#30363d" name="出来高" />
                </ComposedChart>
              </ResponsiveContainer>
            </section>

            {/* RSI Chart */}
            <section className="card">
              <div className="chart-title">RSI (14) — 30以下: 売られ過ぎ / 70以上: 買われ過ぎ</div>
              <ResponsiveContainer width="100%" height={90}>
                <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                  <XAxis dataKey="date" hide />
                  <YAxis domain={[0, 100]} tick={{ fill: '#484f58', fontSize: 9 }} tickLine={false}
                    axisLine={false} width={30} ticks={[20, 50, 80]} />
                  <Tooltip content={<ChartTooltip />} />
                  <ReferenceLine y={80} stroke="#f8514955" strokeDasharray="3 3" />
                  <ReferenceLine y={20} stroke="#3fb95055" strokeDasharray="3 3" />
                  <Line dataKey="rsi" stroke="#d2a8ff" strokeWidth={1.5} dot={false} name="RSI" />
                </LineChart>
              </ResponsiveContainer>
            </section>

            {/* Stochastics Chart */}
            <section className="card">
              <div className="chart-title">ストキャスティクス — 20以下: 売られ過ぎ / 80以上: 買われ過ぎ</div>
              <ResponsiveContainer width="100%" height={90}>
                <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                  <XAxis dataKey="date" hide />
                  <YAxis domain={[0, 100]} tick={{ fill: '#484f58', fontSize: 9 }} tickLine={false}
                    axisLine={false} width={30} ticks={[20, 50, 80]} />
                  <Tooltip content={<ChartTooltip />} />
                  <ReferenceLine y={80} stroke="#f8514955" strokeDasharray="3 3" />
                  <ReferenceLine y={20} stroke="#3fb95055" strokeDasharray="3 3" />
                  <Line dataKey="stochK" stroke="#ffd700" strokeWidth={1.5} dot={false} name="%K" />
                  <Line dataKey="stochD" stroke="#f0883e"  strokeWidth={1}   dot={false} name="%D" />
                </LineChart>
              </ResponsiveContainer>
            </section>

            {/* MACD Chart */}
            <section className="card">
              <div className="chart-title">MACD ヒストグラム — 正: 強気 / 負: 弱気</div>
              <ResponsiveContainer width="100%" height={80}>
                <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
                  <XAxis dataKey="date" hide />
                  <YAxis tick={{ fill: '#484f58', fontSize: 9 }} tickLine={false} axisLine={false} width={40} />
                  <Tooltip content={<ChartTooltip />} />
                  <ReferenceLine y={0} stroke="#484f58" />
                  <Line dataKey="macdHist" stroke="#ffd700" strokeWidth={1.5} dot={false} name="MACDヒスト" />
                  <Line dataKey="macdLine" stroke="#58a6ff" strokeWidth={1} dot={false} name="MACD" />
                  <Line dataKey="macdSig"  stroke="#f0883e" strokeWidth={1} dot={false} name="Signal" />
                </LineChart>
              </ResponsiveContainer>
            </section>

            {/* Indicator grid */}
            <section className="ind-grid">
              <IndCard label="RSI(14)" value={ind.rsi?.toFixed(1)}
                color={ind.rsi > 70 ? '#f85149' : ind.rsi < 30 ? '#3fb950' : '#d2a8ff'}
                sub={ind.rsi > 70 ? '過熱' : ind.rsi < 30 ? '割安' : '中立'} />
              <IndCard label="Stoch %K" value={ind.stochK?.toFixed(1)}
                color={ind.stochK < 20 ? '#3fb950' : ind.stochK > 80 ? '#f85149' : '#ffd700'}
                sub={ind.stochK < 20 ? '売られ過ぎ🔥' : ind.stochK > 80 ? '買われ過ぎ⚠️' : '中立'} />
              <IndCard label="転換線" value={fmt(ind.ichTenkan)}
                color={ind.ichTenkan > ind.ichKijun ? '#3fb950' : '#f85149'}
                sub={ind.ichTenkan > ind.ichKijun ? '強気' : '弱気'} />
              <IndCard label="基準線" value={fmt(ind.ichKijun)}
                color={ind.price > ind.ichKijun ? '#3fb950' : '#f85149'}
                sub={ind.price > ind.ichKijun ? '価格が上' : '価格が下'} />
              <IndCard label="SMA20" value={fmt(ind.sma20)}
                color={ind.price > ind.sma20 ? '#3fb950' : '#f85149'}
                sub={ind.price > ind.sma20 ? '価格が上（強気）' : '価格が下（弱気）'} />
              <IndCard label="SMA50" value={fmt(ind.sma50)}
                color={ind.price > ind.sma50 ? '#3fb950' : '#f85149'}
                sub={ind.price > ind.sma50 ? '中期強気' : '中期弱気'} />
              <IndCard label="MACD Hist" value={ind.macdHist?.toFixed(4)}
                color={ind.macdHist > 0 ? '#3fb950' : '#f85149'}
                sub={ind.macdHist > 0 ? '強気' : '弱気'} />
              <IndCard label="BB位置"
                value={ind.price > ind.bollU ? '上限超え' : ind.price < ind.bollL ? '下限割れ' : 'バンド内'}
                color={ind.price > ind.bollU ? '#f85149' : ind.price < ind.bollL ? '#3fb950' : '#8b949e'} />
              <IndCard label="総合シグナル" value={sig.label} color={sig.color} sub={`${signalScore}/8`} />
            </section>

            {/* Fundamentals */}
            {fundamentals && (
              <section className="card">
                <div className="chart-title">📊 ファンダメンタル分析</div>
                <div className="fund-grid">
                  {fundamentals.trailingPE    != null && <div className="fund-item"><div className="fund-label">PER</div><div className="fund-val">{fundamentals.trailingPE.toFixed(1)}<span className="fund-unit">倍</span></div><div className="fund-desc">株価収益率 (低いほど割安)</div></div>}
                  {fundamentals.priceToBook   != null && <div className="fund-item"><div className="fund-label">PBR</div><div className="fund-val">{fundamentals.priceToBook.toFixed(2)}<span className="fund-unit">倍</span></div><div className="fund-desc">株価純資産倍率 (1倍以下=割安)</div></div>}
                  {fundamentals.dividendYield != null && <div className="fund-item"><div className="fund-label">配当利回り</div><div className="fund-val" style={{color:'#3fb950'}}>{(fundamentals.dividendYield*100).toFixed(2)}<span className="fund-unit">%</span></div><div className="fund-desc">年間配当 ÷ 株価</div></div>}
                  {fundamentals.roe           != null && <div className="fund-item"><div className="fund-label">ROE</div><div className="fund-val" style={{color: fundamentals.roe > 0.15 ? '#3fb950' : '#8b949e'}}>{(fundamentals.roe*100).toFixed(1)}<span className="fund-unit">%</span></div><div className="fund-desc">自己資本利益率 (15%以上良好)</div></div>}
                  {fundamentals.beta          != null && <div className="fund-item"><div className="fund-label">ベータ</div><div className="fund-val">{fundamentals.beta.toFixed(2)}</div><div className="fund-desc">市場感応度 (1=市場並み)</div></div>}
                  {fundamentals.marketCap     != null && <div className="fund-item"><div className="fund-label">時価総額</div><div className="fund-val" style={{fontSize:13}}>{isJPY ? `¥${(fundamentals.marketCap/1e8).toFixed(0)}億` : `$${(fundamentals.marketCap/1e9).toFixed(1)}B`}</div><div className="fund-desc"></div></div>}
                  {fundamentals.week52High    != null && <div className="fund-item"><div className="fund-label">52週高値</div><div className="fund-val" style={{color:'#f85149',fontSize:13}}>{fmt(fundamentals.week52High)}</div><div className="fund-desc">現在価格は{((ind.price/fundamentals.week52High-1)*100).toFixed(1)}%</div></div>}
                  {fundamentals.week52Low     != null && <div className="fund-item"><div className="fund-label">52週安値</div><div className="fund-val" style={{color:'#3fb950',fontSize:13}}>{fmt(fundamentals.week52Low)}</div><div className="fund-desc">現在価格は+{((ind.price/fundamentals.week52Low-1)*100).toFixed(1)}%</div></div>}
                  {fundamentals.revenueGrowth != null && <div className="fund-item"><div className="fund-label">売上成長率</div><div className="fund-val" style={{color: fundamentals.revenueGrowth > 0 ? '#3fb950' : '#f85149'}}>{(fundamentals.revenueGrowth*100).toFixed(1)}<span className="fund-unit">%</span></div><div className="fund-desc">前年同期比</div></div>}
                </div>
              </section>
            )}

            {/* Purchase plan */}
            {(() => {
              const lastATR = chartData.length > 0 ? chartData[chartData.length - 1].atr : null;
              const stopLossPrice   = lastATR ? ind.price - lastATR * atrLossMult : ind.price * 0.95;
              const takeProfitPrice = lastATR ? ind.price + lastATR * atrGainMult : ind.price * 1.10;
              const riskRewardRatio = atrGainMult / atrLossMult;
              return (
                <section className="card purchase-card">
                  <div className="chart-title">💴 購入プラン (予算: ¥{budget.toLocaleString()})</div>
                  <div className="purchase-grid">
                    <div className="purchase-item">
                      <div className="p-label">最大購入株数</div>
                      <div className="p-value big green">{maxShares.toLocaleString()}<span className="p-unit">株</span></div>
                    </div>
                    <div className="purchase-item">
                      <div className="p-label">必要資金</div>
                      <div className="p-value blue">¥{Math.round(totalCost).toLocaleString()}</div>
                    </div>
                    <div className="purchase-item">
                      <div className="p-label">残余資金</div>
                      <div className="p-value gray">¥{Math.round(budget - totalCost).toLocaleString()}</div>
                    </div>
                    <div className="purchase-item">
                      <div className="p-label">
                        損切ライン {lastATR ? `(ATR×${atrLossMult})` : '(-5%)'}
                      </div>
                      <div className="p-value red">{fmt(stopLossPrice)}</div>
                    </div>
                    <div className="purchase-item">
                      <div className="p-label">
                        利確ライン {lastATR ? `(ATR×${atrGainMult})` : '(+10%)'}
                      </div>
                      <div className="p-value green">{fmt(takeProfitPrice)}</div>
                    </div>
                    {lastATR && (
                      <div className="purchase-item" style={{ gridColumn: '1 / -1' }}>
                        <div className="p-label">ATR(14日): {lastATR.toFixed(isJPY ? 0 : 2)} {stockInfo?.currency || ''} &nbsp;|&nbsp; リスク・リワード比: 1 : {riskRewardRatio.toFixed(1)}</div>
                      </div>
                    )}
                  </div>

                  {lastATR && (
                    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <label style={{ fontSize: 12, color: '#8b949e', minWidth: 120 }}>
                          損切倍率: <strong style={{ color: '#f85149' }}>{atrLossMult}×</strong>
                        </label>
                        <input type="range" min="0.5" max="3" step="0.1"
                          value={atrLossMult}
                          onChange={e => setAtrLossMult(Number(e.target.value))}
                          style={{ flex: 1, accentColor: '#f85149' }}
                        />
                        <span style={{ fontSize: 11, color: '#8b949e', minWidth: 80, textAlign: 'right' }}>
                          {fmt(stopLossPrice)}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <label style={{ fontSize: 12, color: '#8b949e', minWidth: 120 }}>
                          利確倍率: <strong style={{ color: '#3fb950' }}>{atrGainMult}×</strong>
                        </label>
                        <input type="range" min="1" max="6" step="0.5"
                          value={atrGainMult}
                          onChange={e => setAtrGainMult(Number(e.target.value))}
                          style={{ flex: 1, accentColor: '#3fb950' }}
                        />
                        <span style={{ fontSize: 11, color: '#8b949e', minWidth: 80, textAlign: 'right' }}>
                          {fmt(takeProfitPrice)}
                        </span>
                      </div>
                    </div>
                  )}
                </section>
              );
            })()}

            {/* AI Advice */}
            <section className="card">
              <div className="chart-title">🤖 AI 売買アドバイス (実データ分析)</div>
              <div className="ai-box">
                {aiLoading
                  ? <span className="ai-loading">⏳ AIがリアルタイムデータを分析中...</span>
                  : <pre className="ai-text">{aiText || '銘柄を選択して分析してください'}</pre>
                }
              </div>
            </section>

            <div className="disclaimer">
              <strong>⚠️ 免責事項</strong><br/>
              本ツールは情報提供・教育目的のみを目的としており、<strong>投資助言・投資勧誘には該当しません</strong>。
              表示される分析結果・シグナルは過去のデータに基づく参考情報であり、将来の値動きを保証するものではありません。
              投資判断は必ずご自身の責任において行ってください。
              Yahoo Finance のデータは遅延がある場合があります。
            </div>
          </>
        )}
        </>
        )}
      </main>
    </div>
  );
}
