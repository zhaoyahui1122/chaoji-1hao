import requests

resp = requests.post("http://127.0.0.1:8012/backtest", json={
    "strategy_type": "turtle", "symbol": "BTC_USDT", "timeframe": "5m", "data_source": "gate",
    "leverage": 50, "initial_balance": 10000, "allocated_margin": 1000,
    "turtle_entry_period": 55, "turtle_exit_period": 18, "turtle_atr_period": 10,
    "turtle_atr_filter": 0.0, "turtle_adx_period": 14, "turtle_adx_threshold": 25.0,
    "turtle_rsi_period": 14, "turtle_rsi_oversold": 35, "turtle_rsi_overbought": 70,
    "turtle_bb_period": 20, "turtle_bb_std": 2.0,
    "turtle_force_mode": "mean_reversion",
    "stop_loss_pct": 0.025, "take_profit_pct": 0.0375,
    "risk_per_trade_pct": 0.01, "fee_rate": 0.00015, "slippage_rate": 0.0001,
}, timeout=120)

r = resp.json()
trades = r["trades"]

# 检查输入参数
inp = r.get("input", {})
print(f"force_mode in input: {inp.get('turtle_force_mode')}")
print(f"stop_loss_pct: {inp.get('stop_loss_pct')}")
print(f"take_profit_pct: {inp.get('take_profit_pct')}")
print()

# 检查前几笔交易的详细信息
for i, t in enumerate(trades[:5], 1):
    print(f"#{i} {t['side']} entry={t['entry_price']:.2f} exit={t['exit_price']:.2f} reason={t['reason']}")
    if t['side'] == 'long':
        tp_price = t['entry_price'] * 1.0375
        sl_price = t['entry_price'] * 0.975
        print(f"   SL={sl_price:.2f} TP={tp_price:.2f} exit/entry={(t['exit_price']/t['entry_price']-1)*100:.2f}%")
    else:
        tp_price = t['entry_price'] * 0.9625
        sl_price = t['entry_price'] * 1.025
        print(f"   SL={sl_price:.2f} TP={tp_price:.2f} exit/entry={(1-t['exit_price']/t['entry_price'])*100:.2f}%")
