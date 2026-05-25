import requests

r = requests.post("http://127.0.0.1:8012/backtest", json={
    "strategy_type": "turtle", "symbol": "BTC_USDT", "timeframe": "5m", "data_source": "gate",
    "leverage": 50, "initial_balance": 10000, "allocated_margin": 1000,
    "turtle_entry_period": 55, "turtle_exit_period": 18, "turtle_atr_period": 10,
    "turtle_adx_period": 14, "turtle_adx_threshold": 25.0,
    "turtle_rsi_period": 14, "turtle_rsi_oversold": 35, "turtle_rsi_overbought": 70,
    "turtle_bb_period": 20, "turtle_bb_std": 2.0,
    "stop_loss_pct": 0.025, "take_profit_pct": 0.03,
    "risk_per_trade_pct": 0.01, "fee_rate": 0.0005, "slippage_rate": 0.0002,
}, timeout=60)
s = r.json()["summary"]
n = s["trades"]

print("=== 手续费详情 ===")
print(f"fee_rate = 0.0005 = 0.05% (单边)")
print(f"leverage = 50x")
print(f"allocated_margin = 1000 U")
print(f"notional per trade = 1000 * 50 = 50,000 U")
print(f"单边手续费 = 50,000 * 0.05% = 25 U")
print(f"开平一次 = 50 U")
print()
print(f"总交易: {n} 笔")
print(f"总手续费: {s['total_fees']:.2f} U")
print(f"每笔平均手续费: {s['total_fees']/max(n,1):.2f} U")
print(f"毛利: {s['total_gross_pnl']:.2f} U")
print(f"净利: {s['total_net_pnl']:.2f} U")

# Gate.io actual fee tiers
print()
print("=== Gate.io 合约手续费参考 ===")
print("普通用户: Maker 0.015% / Taker 0.05%")
print("VIP1:     Maker 0.014% / Taker 0.045%")
print("VIP2:     Maker 0.012% / Taker 0.04%")
print("VIP3:     Maker 0.01%  / Taker 0.035%")
print()
print("当前回测用的是 Taker 费率 0.05% (最贵)")
print("如果用限价单 (Maker) 0.015%，手续费降 70%")
