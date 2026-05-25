import requests

# Test 1: SL=2.5% TP=3.75% (1:1.5)
resp1 = requests.post("http://127.0.0.1:8012/backtest", json={
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

# Test 2: SL=2.5% TP=3% (1:1.2)
resp2 = requests.post("http://127.0.0.1:8012/backtest", json={
    "strategy_type": "turtle", "symbol": "BTC_USDT", "timeframe": "5m", "data_source": "gate",
    "leverage": 50, "initial_balance": 10000, "allocated_margin": 1000,
    "turtle_entry_period": 55, "turtle_exit_period": 18, "turtle_atr_period": 10,
    "turtle_atr_filter": 0.0, "turtle_adx_period": 14, "turtle_adx_threshold": 25.0,
    "turtle_rsi_period": 14, "turtle_rsi_oversold": 35, "turtle_rsi_overbought": 70,
    "turtle_bb_period": 20, "turtle_bb_std": 2.0,
    "turtle_force_mode": "mean_reversion",
    "stop_loss_pct": 0.025, "take_profit_pct": 0.03,
    "risk_per_trade_pct": 0.01, "fee_rate": 0.00015, "slippage_rate": 0.0001,
}, timeout=120)

r1 = resp1.json()["summary"]
r2 = resp2.json()["summary"]

print("对比:")
print(f"  1:1.5 (TP=3.75%): {r1['trades']}笔, 胜率{r1['win_rate_pct']:.1f}%, 净利{r1['total_net_pnl']:.2f} U")
print(f"  1:1.2 (TP=3%):    {r2['trades']}笔, 胜率{r2['win_rate_pct']:.1f}%, 净利{r2['total_net_pnl']:.2f} U")
