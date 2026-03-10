// ── Fetch stock data from Yahoo Finance (via local proxy) ──────────
export async function fetchStockData(symbol, range = '3mo') {
  const res = await fetch(`/api/stock/${encodeURIComponent(symbol)}?range=${range}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();

  const result = json?.chart?.result?.[0];
  if (!result) throw new Error('銘柄が見つかりません。コードを確認してください。');

  const timestamps = result.timestamp;
  const q = result.indicators.quote[0];
  const adjclose = result.indicators.adjclose?.[0]?.adjclose ?? q.close;
  const meta = result.meta;

  const prices = timestamps
    .map((ts, i) => ({
      date:   new Date(ts * 1000).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' }),
      close:  adjclose[i] ?? q.close[i],
      high:   q.high?.[i]   ?? q.close[i],
      low:    q.low?.[i]    ?? q.close[i],
      volume: q.volume?.[i] ?? 0,
    }))
    .filter(p => p.close != null);

  if (prices.length < 30)
    throw new Error('データが不足しています（上場間もない銘柄か無効なコードの可能性があります）');

  return {
    prices,
    currency:     meta.currency,
    name:         meta.longName || meta.shortName || symbol,
    currentPrice: meta.regularMarketPrice,
  };
}

// ── Fetch fundamental data from Yahoo Finance ──────────────────────
export async function fetchFundamentals(symbol) {
  try {
    const res = await fetch(`/api/fundamentals/${encodeURIComponent(symbol)}`);
    if (!res.ok) return null;
    const json = await res.json();
    const r = json?.quoteSummary?.result?.[0];
    if (!r) return null;

    const sd = r.summaryDetail       || {};
    const ks = r.defaultKeyStatistics || {};
    const fd = r.financialData        || {};

    // yahoo-finance2 returns plain numbers (no .raw); support both formats
    const val = (v) => (v != null && typeof v === 'object' ? v.raw : v) ?? null;
    return {
      trailingPE:      val(sd.trailingPE),
      forwardPE:       val(sd.forwardPE),
      priceToBook:     val(sd.priceToBook) ?? val(ks.priceToBook),
      dividendYield:   val(sd.dividendYield),
      marketCap:       val(sd.marketCap),
      beta:            val(sd.beta),
      week52High:      val(sd.fiftyTwoWeekHigh),
      week52Low:       val(sd.fiftyTwoWeekLow),
      trailingEps:     val(ks.trailingEps),
      forwardEps:      val(ks.forwardEps),
      roe:             val(fd.returnOnEquity),
      revenueGrowth:   val(fd.revenueGrowth),
      grossMargins:    val(fd.grossMargins),
    };
  } catch {
    return null;
  }
}

// ── Ask Claude for trade advice ────────────────────────────────────
export async function fetchAIAdvice({ symbol, name, ind, budget, currency, fundamentals }) {
  const isJPY = currency === 'JPY';
  const lotSize = isJPY ? 100 : 1;
  const maxShares = Math.floor(budget / ind.price / lotSize) * lotSize;

  const fundSection = fundamentals ? `
【ファンダメンタル指標】
${fundamentals.trailingPE    != null ? `PER（株価収益率）: ${fundamentals.trailingPE.toFixed(1)}倍` : ''}
${fundamentals.priceToBook   != null ? `PBR（株価純資産倍率）: ${fundamentals.priceToBook.toFixed(2)}倍` : ''}
${fundamentals.dividendYield != null ? `配当利回り: ${(fundamentals.dividendYield * 100).toFixed(2)}%` : ''}
${fundamentals.roe           != null ? `ROE（自己資本利益率）: ${(fundamentals.roe * 100).toFixed(1)}%` : ''}
${fundamentals.beta          != null ? `ベータ（市場感応度）: ${fundamentals.beta.toFixed(2)}` : ''}
${fundamentals.marketCap     != null ? `時価総額: ${isJPY ? '¥' : '$'}${(fundamentals.marketCap / 1e8).toFixed(0)}億` : ''}
${fundamentals.revenueGrowth != null ? `売上成長率: ${(fundamentals.revenueGrowth * 100).toFixed(1)}%` : ''}` : '';

  const prompt = `あなたは技術指標の解説者です。投資アドバイザーではなく、投資助言・投資勧誘は行いません。以下のデータを客観的に分析し、あくまで参考情報として初心者向けに解説してください。

銘柄: ${name} (${symbol})
現在価格: ${isJPY ? '¥' : '$'}${ind.price.toLocaleString()} ${currency}
予算: ¥${budget.toLocaleString()} / 最大購入数: ${maxShares}株

【テクニカル指標】
SMA20: ${ind.sma20?.toFixed(2)} / SMA50: ${ind.sma50?.toFixed(2)}
トレンド: SMA20の${ind.price > ind.sma20 ? '上（強気）' : '下（弱気）'} / SMA50の${ind.price > ind.sma50 ? '上' : '下'}
RSI(14): ${ind.rsi?.toFixed(1)} → ${ind.rsi > 70 ? '買われ過ぎ⚠️' : ind.rsi < 30 ? '売られ過ぎ🔥' : '中立'}
MACD: ${ind.macdHist > 0 ? '強気（ヒスト正）' : '弱気（ヒスト負）'}
ボリンジャー: ${ind.price > ind.bollU ? '上限超え（過熱）' : ind.price < ind.bollL ? '下限割れ（割安）' : 'バンド内'}
ストキャスティクス %K: ${ind.stochK?.toFixed(1)} ${ind.stochK < 20 ? '→ 売られ過ぎ🔥' : ind.stochK > 80 ? '→ 買われ過ぎ⚠️' : ''}
一目均衡表: 転換線${ind.ichTenkan?.toFixed(1) ?? 'N/A'} / 基準線${ind.ichKijun?.toFixed(1) ?? 'N/A'} → ${ind.ichTenkan > ind.ichKijun ? '転換線上位（強気）' : '基準線上位（弱気）'}
${fundSection}
以下の形式で簡潔に回答:
**【総合判定】** 強気買い / やや買い / 様子見 / 売り注意 のどれか
**【推奨株数】** 具体的な株数
**【エントリー価格】** 理想の買値
**【損切りライン】** 具体的価格と理由
**【利確ライン】** 具体的価格と理由
**【ひとこと解説】** テクニカルとファンダメンタルを踏まえて初心者向けに2文で

※本分析は技術指標に基づく参考情報であり、投資助言・投資勧誘ではありません。投資判断はご自身の責任で行ってください。`;

  const res = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: prompt }] }),
  });

  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.content?.map(c => c.text || '').join('\n') || '分析できませんでした';
}
