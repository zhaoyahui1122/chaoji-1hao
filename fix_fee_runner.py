import os

path = r"C:\Users\14513\.openclaw\workspace\quant-gate-mvp\apps\api\app\services\strategy_runner.py"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

new = content.replace('config.get("fee_rate", 0.0005)', 'config.get("fee_rate", 0.00015)')
new = new.replace('config.get("slippage_rate", 0.0002)', 'config.get("slippage_rate", 0.0001)')

with open(path, "w", encoding="utf-8") as f:
    f.write(new)

print("Updated strategy_runner.py defaults")
