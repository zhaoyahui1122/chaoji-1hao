import re

path = r"C:\Users\14513\.openclaw\workspace\quant-gate-mvp\apps\api\app\services\strategy_store.py"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

# Replace all fee_rate: 0.0005 -> 0.00015
content = content.replace('"fee_rate": 0.0005', '"fee_rate": 0.00015')
# Replace all slippage_rate: 0.0002 -> 0.0001
content = content.replace('"slippage_rate": 0.0002', '"slippage_rate": 0.0001')

with open(path, "w", encoding="utf-8") as f:
    f.write(content)

print("Done. Updated all fee_rate and slippage_rate in strategy_store.py")
