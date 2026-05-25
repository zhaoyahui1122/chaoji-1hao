from app.services.market_data import get_ohlcv
from app.backtest.engine import SimpleBacktester

df, meta = get_ohlcv('BTC_USDT', '5m', source='gate')
bt = SimpleBacktester(initial_balance=10000)
result = bt.run(df, {
    "strategy_type": "turtle",
    "turtle_entry_period": 20,
    "turtle_exit_period": 10,
    "turtle_atr_period": 14,
    "turtle_atr_filter": 0,
    "risk_per_trade_pct": 0.01,
    "stop_loss_pct": 0.02,
    "take_profit_pct": 0.04,
    "fee_rate": 0.0005,
    "slippage_rate": 0.0002,
})
s = result.summary
print(f"Trades: {s['trades']}")
print(f"Return: {s['return_pct']}%")
print(f"Win rate: {s['win_rate_pct']}%")

if result.trades:
    for t in result.trades[:5]:
        print(f"  {t['side']} {t['entry_price']:.0f} -> {t['exit_price']:.0f} | {t['reason']} | PnL: {t['pnl']:.2f}")
