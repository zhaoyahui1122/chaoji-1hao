import requests, json

# 海龟回测 - 验证多空双向
r = requests.post('http://127.0.0.1:8012/backtest', json={
    'strategy_type': 'turtle',
    'symbol': 'BTC_USDT', 'timeframe': '5m', 'data_source': 'gate',
    'initial_balance': 10000, 'leverage': 50,
    'turtle_entry_period': 20, 'turtle_exit_period': 10, 'turtle_atr_period': 14,
    'risk_per_trade_pct': 0.01, 'stop_loss_pct': 0.02, 'take_profit_pct': 0.04,
    'fee_rate': 0.0005, 'slippage_rate': 0.0002,
})
d = r.json()
s = d['summary']
trades = s['trades']
longs = [t for t in d['trades'] if t['side'] == 'long']
shorts = [t for t in d['trades'] if t['side'] == 'short']
print(f"海龟回测: {trades} 笔")
print(f"  做多: {len(longs)} 笔 | 做空: {len(shorts)} 笔")
print(f"  胜率: {s['win_rate_pct']}% | 收益: {s['return_pct']}%")

# 经典策略回测
r2 = requests.post('http://127.0.0.1:8012/backtest', json={
    'strategy_type': 'classic',
    'symbol': 'BTC_USDT', 'timeframe': '5m', 'data_source': 'gate',
    'initial_balance': 10000, 'leverage': 50,
    'boll_period': 20, 'boll_std': 2.0, 'rsi_period': 14,
    'ma_short': 9, 'ma_long': 21,
    'rsi_oversold': 30, 'rsi_overbought': 70,
    'use_boll': True, 'use_rsi': True, 'use_ma': True,
    'risk_per_trade_pct': 0.01, 'stop_loss_pct': 0.02, 'take_profit_pct': 0.04,
    'fee_rate': 0.0005, 'slippage_rate': 0.0002,
})
d2 = r2.json()
s2 = d2['summary']
longs2 = [t for t in d2['trades'] if t['side'] == 'long']
shorts2 = [t for t in d2['trades'] if t['side'] == 'short']
print(f"\n经典回测: {s2['trades']} 笔")
print(f"  做多: {len(longs2)} 笔 | 做空: {len(shorts2)} 笔")
print(f"  胜率: {s2['win_rate_pct']}% | 收益: {s2['return_pct']}%")
