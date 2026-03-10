import { useState } from 'react';
import { placeOrder } from './kabuApi';

// ── 注文確認モーダル ──────────────────────────────────────────────
// Props:
//   order: { symbol, name, side, price, suggestedQty, isJPY }
//   kabuStatus: { connected, mock }
//   onClose: () => void
//   onDone: (result) => void
export default function KabuOrder({ order, kabuStatus, onClose, onDone }) {
  const [qty, setQty] = useState(order.suggestedQty || 100);
  const [orderType, setOrderType] = useState('market');
  const [limitPrice, setLimitPrice] = useState(order.price || '');
  const [orderPw, setOrderPw] = useState('');
  const [useMock, setUseMock] = useState(!kabuStatus?.connected);
  const [step, setStep] = useState('input'); // 'input' | 'confirm' | 'done' | 'error'
  const [result, setResult] = useState(null);
  const [errMsg, setErrMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const isBuy = order.side === 'buy';
  const fmt = v => order.isJPY ? `¥${Math.round(v).toLocaleString()}` : `$${Number(v).toFixed(2)}`;
  const execPrice = orderType === 'market' ? order.price : limitPrice;
  const totalEst = Math.round(execPrice * qty);

  const handleConfirm = () => {
    if (!useMock && !orderPw) {
      setErrMsg('注文パスワードを入力してください');
      return;
    }
    setErrMsg('');
    setStep('confirm');
  };

  const handleExecute = async () => {
    setLoading(true);
    try {
      const res = await placeOrder({
        symbol: order.symbol,
        side: order.side,
        qty: Number(qty),
        orderType,
        price: orderType === 'limit' ? Number(limitPrice) : 0,
        orderPassword: orderPw,
        mock: useMock,
      });
      setResult(res);
      setStep('done');
      onDone?.(res);
    } catch (e) {
      setErrMsg(e.message);
      setStep('error');
    }
    setLoading(false);
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box">
        {/* Header */}
        <div className="modal-header">
          <div>
            <span className={`modal-side-badge ${isBuy ? 'buy' : 'sell'}`}>
              {isBuy ? '● 買い注文' : '● 売り注文'}
            </span>
            <div className="modal-title">{order.name}</div>
            <div className="modal-symbol">{order.symbol}</div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {/* Mock warning */}
        {useMock && (
          <div className="mock-banner">
            🧪 モックモード — 実際には発注されません（テスト用）
          </div>
        )}

        {/* Step: Input */}
        {step === 'input' && (
          <div className="modal-body">
            <div className="order-grid">
              <div className="order-field">
                <div className="order-label">現在価格</div>
                <div className="order-val">{fmt(order.price)}</div>
              </div>
              <div className="order-field">
                <div className="order-label">株数</div>
                <input
                  className="number-input"
                  type="number"
                  value={qty}
                  min={order.isJPY ? 100 : 1}
                  step={order.isJPY ? 100 : 1}
                  onChange={e => setQty(e.target.value)}
                  style={{ width: '100%' }}
                />
              </div>
              <div className="order-field">
                <div className="order-label">注文タイプ</div>
                <div className="range-btns" style={{ gap: 6 }}>
                  <button className={`range-btn ${orderType === 'market' ? 'active' : ''}`}
                    onClick={() => setOrderType('market')}>成行</button>
                  <button className={`range-btn ${orderType === 'limit' ? 'active' : ''}`}
                    onClick={() => setOrderType('limit')}>指値</button>
                </div>
              </div>
              {orderType === 'limit' && (
                <div className="order-field">
                  <div className="order-label">指値</div>
                  <input
                    className="number-input"
                    type="number"
                    value={limitPrice}
                    onChange={e => setLimitPrice(e.target.value)}
                    style={{ width: '100%' }}
                  />
                </div>
              )}
            </div>

            {/* Estimated total */}
            <div className="order-total">
              概算金額: <span>{fmt(totalEst)}</span>
              <span style={{ fontSize: 10, color: '#484f58', marginLeft: 8 }}>
                ({qty}株 × {fmt(execPrice)})
              </span>
            </div>

            {/* Order password */}
            {!useMock && (
              <div style={{ marginBottom: 12 }}>
                <div className="order-label" style={{ marginBottom: 4 }}>注文パスワード</div>
                <input
                  className="text-input"
                  type="password"
                  placeholder="kabu.com の注文パスワード"
                  value={orderPw}
                  onChange={e => setOrderPw(e.target.value)}
                />
                <div style={{ fontSize: 10, color: '#484f58', marginTop: 4 }}>
                  ※ パスワードはサーバーに保存されません
                </div>
              </div>
            )}

            {/* Mock toggle */}
            <label className="mock-toggle">
              <input type="checkbox" checked={useMock} onChange={e => setUseMock(e.target.checked)} />
              <span>モックモードで実行（テスト）</span>
            </label>

            {errMsg && <div className="order-error">{errMsg}</div>}

            <button className={`analyze-btn ${isBuy ? '' : 'sell-order-btn'}`}
              style={{ width: '100%', marginTop: 12 }}
              onClick={handleConfirm}>
              注文確認画面へ →
            </button>
          </div>
        )}

        {/* Step: Confirm */}
        {step === 'confirm' && (
          <div className="modal-body">
            <div className="confirm-box">
              <div className="confirm-row">
                <span>銘柄</span><span>{order.name} ({order.symbol})</span>
              </div>
              <div className="confirm-row">
                <span>売買</span>
                <span style={{ color: isBuy ? '#3fb950' : '#f85149', fontWeight: 700 }}>
                  {isBuy ? '買い' : '売り'}
                </span>
              </div>
              <div className="confirm-row">
                <span>株数</span><span>{Number(qty).toLocaleString()} 株</span>
              </div>
              <div className="confirm-row">
                <span>注文タイプ</span><span>{orderType === 'market' ? '成行' : `指値 ${fmt(limitPrice)}`}</span>
              </div>
              <div className="confirm-row">
                <span>概算金額</span>
                <span style={{ fontSize: 18, fontWeight: 800, color: '#e6edf3' }}>{fmt(totalEst)}</span>
              </div>
              <div className="confirm-row">
                <span>モード</span>
                <span style={{ color: useMock ? '#d2a8ff' : '#3fb950' }}>
                  {useMock ? '🧪 モック（テスト）' : '🔴 本番（実際に発注）'}
                </span>
              </div>
            </div>

            {!useMock && (
              <div className="real-order-warning">
                ⚠️ これは実際の注文です。内容を確認してから実行してください。
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button className="stop-btn" style={{ flex: 1 }} onClick={() => setStep('input')}>
                ← 戻る
              </button>
              <button
                className={`analyze-btn ${isBuy ? '' : 'sell-order-btn'}`}
                style={{ flex: 2 }}
                onClick={handleExecute}
                disabled={loading}
              >
                {loading ? '発注中...' : (useMock ? '🧪 モック発注' : '🔴 注文実行')}
              </button>
            </div>
          </div>
        )}

        {/* Step: Done */}
        {step === 'done' && (
          <div className="modal-body" style={{ textAlign: 'center', padding: '32px 16px' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
            <div style={{ color: '#3fb950', fontWeight: 700, fontSize: 16, marginBottom: 8 }}>
              {useMock ? 'モック注文完了' : '注文が受け付けられました'}
            </div>
            <div style={{ color: '#484f58', fontSize: 12, marginBottom: 4 }}>
              注文ID: {result?.OrderId}
            </div>
            {!useMock && (
              <div style={{ color: '#484f58', fontSize: 11, marginTop: 8 }}>
                auカブコム証券の注文画面で状況を確認してください
              </div>
            )}
            <button className="analyze-btn" style={{ marginTop: 20 }} onClick={onClose}>
              閉じる
            </button>
          </div>
        )}

        {/* Step: Error */}
        {step === 'error' && (
          <div className="modal-body" style={{ textAlign: 'center', padding: '32px 16px' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>❌</div>
            <div style={{ color: '#f85149', fontWeight: 700, marginBottom: 8 }}>注文エラー</div>
            <div style={{ color: '#8b949e', fontSize: 12, marginBottom: 16 }}>{errMsg}</div>
            <button className="range-btn active" onClick={() => setStep('input')}>← 戻る</button>
          </div>
        )}
      </div>
    </div>
  );
}
