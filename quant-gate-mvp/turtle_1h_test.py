"""
海龟策略1小时实盘测试
每5分钟运行一次 runner，持续1小时
"""
import json
import time
import urllib.request
from datetime import datetime, timedelta

API_BASE = "http://127.0.0.1:8012"
INTERVAL_SECONDS = 5 * 60  # 5分钟
TOTAL_DURATION = 60 * 60    # 1小时
RUNNER_CONFIG = {
    "strategy_type": "turtle",
    "symbol": "BTC_USDT",
    "timeframe": "5m",
    "data_source": "gate",
    "leverage": 20,
    "allocated_margin": 1000,
    "turtle_entry_period": 20,
    "turtle_exit_period": 10,
    "turtle_atr_period": 14,
    "turtle_atr_filter": 0.0,
    "use_boll": False,
    "use_rsi": False,
    "use_ma": False,
    "stop_loss_pct": 0.02,
    "take_profit_pct": 0.04,
    "risk_per_trade_pct": 0.01,
    "fee_rate": 0.0005,
    "slippage_rate": 0.0002,
}

def api_post(path, data=None):
    body = json.dumps(data or {}).encode()
    req = urllib.request.Request(
        f"{API_BASE}{path}",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    resp = urllib.request.urlopen(req, timeout=30)
    return json.loads(resp.read())

def api_get(path):
    req = urllib.request.Request(f"{API_BASE}{path}")
    resp = urllib.request.urlopen(req, timeout=15)
    return json.loads(resp.read())

def main():
    start_time = datetime.now()
    end_time = start_time + timedelta(seconds=TOTAL_DURATION)
    cycle = 0
    results = []
    
    # 先重置纸面账户，清除历史持仓
    reset_result = api_post("/runner/reset-paper")
    print(f"纸面账户已重置: {reset_result}")
    
    # 记录初始状态
    dashboard = api_get("/dashboard")
    initial_equity = dashboard["account"]["equity"]
    print(f"=== 海龟策略1小时测试开始 ===")
    print(f"开始时间: {start_time.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"结束时间: {end_time.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"初始权益: {initial_equity:.4f} USDT")
    print(f"策略: 海龟策略 Entry(20)/Exit(10)/ATR(14)")
    print(f"周期: 5m | 杠杆: 20x | 交易对: BTC_USDT")
    print(f"每 {INTERVAL_SECONDS//60} 分钟运行一次，共 {TOTAL_DURATION//60} 分钟")
    print("=" * 50)
    
    while datetime.now() < end_time:
        cycle += 1
        now = datetime.now()
        remaining = (end_time - now).total_seconds()
        
        print(f"\n--- Cycle {cycle} | {now.strftime('%H:%M:%S')} | 剩余 {remaining/60:.0f}min ---")
        
        try:
            # 运行一次策略
            result = api_post("/runner/run-once", RUNNER_CONFIG)
            action = result.get("action", "unknown")
            signal = result.get("signal")
            price = result.get("price", 0)
            
            print(f"  Action: {action} | Signal: {signal} | Price: {price}")
            
            # 获取当前状态
            dashboard = api_get("/dashboard")
            equity = dashboard["account"]["equity"]
            positions = dashboard["account"]["open_positions"]
            unrealized = dashboard["account"]["unrealized_pnl"]
            
            print(f"  权益: {equity:.4f} | 持仓: {positions} | 未实现盈亏: {unrealized:.4f}")
            
            results.append({
                "cycle": cycle,
                "time": now.strftime("%Y-%m-%d %H:%M:%S"),
                "action": action,
                "signal": signal,
                "price": price,
                "equity": equity,
                "positions": positions,
                "unrealized_pnl": unrealized,
            })
            
        except Exception as e:
            print(f"  ERROR: {e}")
            results.append({
                "cycle": cycle,
                "time": now.strftime("%Y-%m-%d %H:%M:%S"),
                "action": "error",
                "signal": None,
                "price": 0,
                "equity": 0,
                "positions": 0,
                "unrealized_pnl": 0,
                "error": str(e),
            })
        
        # 等待下一个周期
        if remaining > INTERVAL_SECONDS:
            print(f"  等待 {INTERVAL_SECONDS} 秒...")
            time.sleep(INTERVAL_SECONDS)
        else:
            break
    
    # 最终报告
    final_dashboard = api_get("/dashboard")
    final_equity = final_dashboard["account"]["equity"]
    pnl = final_equity - initial_equity
    pnl_pct = (pnl / initial_equity) * 100
    
    print("\n" + "=" * 50)
    print(f"=== 海龟策略1小时测试结束 ===")
    print(f"结束时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"初始权益: {initial_equity:.4f} USDT")
    print(f"最终权益: {final_equity:.4f} USDT")
    print(f"总盈亏: {pnl:.4f} USDT ({pnl_pct:+.2f}%)")
    print(f"总轮次: {cycle}")
    
    # 统计交易动作
    actions = [r["action"] for r in results if r["action"] != "error"]
    signals = [r["signal"] for r in results if r.get("signal")]
    print(f"交易动作统计:")
    for a in set(actions):
        print(f"  {a}: {actions.count(a)} 次")
    if signals:
        print(f"信号统计:")
        for s in set(signals):
            print(f"  {s}: {signals.count(s)} 次")
    
    # 保存详细结果到文件
    report = {
        "start_time": start_time.strftime("%Y-%m-%d %H:%M:%S"),
        "end_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "initial_equity": initial_equity,
        "final_equity": final_equity,
        "pnl": pnl,
        "pnl_pct": pnl_pct,
        "total_cycles": cycle,
        "config": RUNNER_CONFIG,
        "results": results,
    }
    
    report_path = r"C:\Users\14513\.openclaw\workspace\quant-gate-mvp\turtle_test_report.json"
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"\n详细报告已保存: {report_path}")

if __name__ == "__main__":
    main()
