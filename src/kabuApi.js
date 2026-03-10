// ── kabu+ API フロントエンドクライアント ──────────────────────────

export async function fetchKabuStatus() {
  const r = await fetch('/api/kabu/status');
  return r.json();
}

export async function fetchKabuWallet() {
  const r = await fetch('/api/kabu/wallet');
  if (!r.ok) throw new Error('買付余力の取得に失敗しました');
  return r.json();
}

export async function fetchKabuPositions() {
  const r = await fetch('/api/kabu/positions');
  if (!r.ok) throw new Error('保有株の取得に失敗しました');
  return r.json();
}

// ── 注文送信 ──────────────────────────────────────────────────────
// side: 'buy' | 'sell'
// orderType: 'market' | 'limit'
// mock: true でモック注文（実際には発注しない）
export async function placeOrder({
  symbol,       // 例: '7203' (.T なし)
  side,         // 'buy' | 'sell'
  qty,          // 株数
  orderType,    // 'market' | 'limit'
  price,        // 指値価格（成行なら 0）
  orderPassword,// 注文パスワード（モックなら不要）
  mock = false,
}) {
  const body = {
    mock,
    Password: orderPassword || '',
    Symbol: symbol.replace('.T', '').replace('-USD', ''),
    Exchange: 1,          // 東証
    SecurityType: 1,      // 株式
    Side: side === 'buy' ? '2' : '1',
    CashMargin: 1,        // 現物
    DelivType: 2,         // 自動振替
    AccountType: 4,       // 特定口座
    Qty: qty,
    FrontOrderType: orderType === 'market' ? 10 : 20,
    Price: orderType === 'market' ? 0 : price,
    ExpireDay: 0,         // 当日
  };

  const r = await fetch('/api/kabu/order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (data.error) throw new Error(data.error);
  if (data.Result && data.Result !== 0) throw new Error(`注文エラー (Code: ${data.Result})`);
  return data;
}
