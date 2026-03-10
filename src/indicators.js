// ── Moving Averages ────────────────────────────────────────────────
export const calcSMA = (prices, period) =>
  prices.map((_, i) =>
    i < period - 1
      ? null
      : prices.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period
  );

export const calcEMA = (prices, period) => {
  const k = 2 / (period + 1);
  const ema = [prices[0]];
  for (let i = 1; i < prices.length; i++)
    ema.push(prices[i] * k + ema[i - 1] * (1 - k));
  return ema;
};

// ── RSI ────────────────────────────────────────────────────────────
export const calcRSI = (prices, period = 14) => {
  const changes = prices.slice(1).map((v, i) => v - prices[i]);
  return prices.map((_, idx) => {
    if (idx <= period) return null;
    const slice = changes.slice(idx - period, idx);
    const gains = slice.filter(c => c > 0).reduce((a, b) => a + b, 0) / period;
    const losses = Math.abs(slice.filter(c => c < 0).reduce((a, b) => a + b, 0)) / period;
    return losses === 0 ? 100 : 100 - 100 / (1 + gains / losses);
  });
};

// ── MACD ───────────────────────────────────────────────────────────
export const calcMACD = (prices) => {
  const ema12 = calcEMA(prices, 12);
  const ema26 = calcEMA(prices, 26);
  const line = ema12.map((v, i) => v - ema26[i]);
  const sig = calcEMA(line, 9);
  const hist = line.map((v, i) => v - sig[i]);
  return { line, sig, hist };
};

// ── Bollinger Bands ────────────────────────────────────────────────
export const calcBollinger = (prices, period = 20, mult = 2) => {
  const sma = calcSMA(prices, period);
  return prices.map((_, i) => {
    if (i < period - 1) return { u: null, m: null, l: null };
    const slice = prices.slice(i - period + 1, i + 1);
    const mean = sma[i];
    const sd = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
    return { u: mean + mult * sd, m: mean, l: mean - mult * sd };
  });
};

// ── Stochastics (%K / %D) ──────────────────────────────────────────
export const calcStochastics = (highs, lows, closes, kPeriod = 14, dPeriod = 3) => {
  const k = closes.map((c, i) => {
    if (i < kPeriod - 1) return null;
    const h = Math.max(...highs.slice(i - kPeriod + 1, i + 1));
    const l = Math.min(...lows.slice(i - kPeriod + 1, i + 1));
    if (h === l) return 50;
    return (c - l) / (h - l) * 100;
  });
  const d = k.map((_, i) => {
    const slice = k.slice(Math.max(0, i - dPeriod + 1), i + 1).filter(v => v != null);
    return slice.length === dPeriod ? slice.reduce((a, b) => a + b, 0) / dPeriod : null;
  });
  return { k, d };
};

// ── 一目均衡表 ────────────────────────────────────────────────────
export const calcIchimoku = (highs, lows) => {
  const mid = (period, i) => {
    if (i < period - 1) return null;
    const h = Math.max(...highs.slice(i - period + 1, i + 1));
    const l = Math.min(...lows.slice(i - period + 1, i + 1));
    return (h + l) / 2;
  };
  const tenkan  = highs.map((_, i) => mid(9, i));   // 転換線
  const kijun   = highs.map((_, i) => mid(26, i));  // 基準線
  const senkouA = tenkan.map((t, i) =>              // 先行スパンA
    t != null && kijun[i] != null ? (t + kijun[i]) / 2 : null
  );
  const senkouB = highs.map((_, i) => mid(52, i));  // 先行スパンB
  return { tenkan, kijun, senkouA, senkouB };
};

// ── ATR (Average True Range) 14日 ─────────────────────────────────
// Wilder's RMA: alpha = 1/period
export const calcATR = (highs, lows, closes, period = 14) => {
  if (!highs || highs.length < 2) return new Array(highs ? highs.length : 0).fill(null);
  const trs = highs.map((h, i) => {
    if (i === 0) return h - lows[i];
    const pc = closes[i - 1];
    return Math.max(h - lows[i], Math.abs(h - pc), Math.abs(lows[i] - pc));
  });
  const atrs = new Array(highs.length).fill(null);
  if (trs.length >= period) {
    // 最初のATR = 最初のperiod本のTRの単純平均
    atrs[period - 1] = trs.slice(0, period).reduce((s, v) => s + v, 0) / period;
    for (let i = period; i < trs.length; i++) {
      atrs[i] = (atrs[i - 1] * (period - 1) + trs[i]) / period;
    }
  }
  return atrs;
};

// ── Build chart dataset ────────────────────────────────────────────
export const buildChartData = (prices) => {
  const closes = prices.map(p => p.close);
  const highs  = prices.map(p => p.high  ?? p.close);
  const lows   = prices.map(p => p.low   ?? p.close);

  const sma20  = calcSMA(closes, 20);
  const sma50  = calcSMA(closes, 50);
  const rsi    = calcRSI(closes, 14);
  const macd   = calcMACD(closes);
  const boll   = calcBollinger(closes, 20);
  const stoch  = calcStochastics(highs, lows, closes);
  const ich    = calcIchimoku(highs, lows);
  const atrArr = calcATR(highs, lows, closes, 14);

  return prices.map((p, i) => ({
    date:       p.date,
    close:      p.close,
    high:       p.high,
    low:        p.low,
    volume:     p.volume ?? 0,
    sma20:      sma20[i],
    sma50:      sma50[i],
    rsi:        rsi[i],
    macdHist:   macd.hist[i],
    macdLine:   macd.line[i],
    macdSig:    macd.sig[i],
    bollU:      boll[i].u,
    bollM:      boll[i].m,
    bollL:      boll[i].l,
    stochK:     stoch.k[i],
    stochD:     stoch.d[i],
    ichTenkan:  ich.tenkan[i],
    ichKijun:   ich.kijun[i],
    // 先行スパンは26期間先送りなので、表示位置を26期間ずらす
    ichSenkouA: i >= 26 ? ich.senkouA[i - 26] : null,
    ichSenkouB: i >= 26 ? ich.senkouB[i - 26] : null,
    atr:        atrArr[i],
  }));
};

// ── Signal scoring (0–8) ───────────────────────────────────────────
export const scoreSignal = (ind) => {
  let s = 0;
  if (ind.price > ind.sma20)                                          s++; // SMA20上方
  if (ind.sma20 != null && ind.sma50 != null && ind.sma20 > ind.sma50) s++; // 中期ゴールデン傾向
  if (ind.rsi != null && ind.rsi > 0 && ind.rsi < 55)                s++; // RSI過熱なし
  if (ind.macdHist > 0)                                               s++; // MACD強気
  if (ind.bollL != null && ind.price > ind.bollL && ind.price < ind.bollU) s++; // BB内
  if (ind.stochK != null && ind.stochK < 40)                         s++; // Stoch売られ過ぎ圏
  if (ind.ichTenkan != null && ind.ichKijun != null &&
      ind.price > ind.ichTenkan && ind.price > ind.ichKijun)         s++; // 転換線・基準線上
  if (ind.ichTenkan != null && ind.ichKijun != null &&
      ind.ichTenkan > ind.ichKijun)                                   s++; // 転換線 > 基準線（強気）
  return s; // 0–8
};

export const SIGNAL_MAP = [
  { min: 7, label: '🚀 強気買い',  color: '#00ff88' },
  { min: 5, label: '📈 やや買い',  color: '#7fff44' },
  { min: 3, label: '⚖️ 中立',     color: '#ffd700' },
  { min: 1, label: '⚠️ 様子見',   color: '#ff9944' },
  { min: 0, label: '🔻 売り注意', color: '#ff4466' },
];
