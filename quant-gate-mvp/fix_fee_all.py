import os

base = r"C:\Users\14513\.openclaw\workspace\quant-gate-mvp\apps\api\app"

files_to_update = [
    "api/routes_runner.py",
    "api/routes_backtest.py",
    "api/routes_paper.py",
    "api/routes_strategy.py",
    "core/settings.py",
]

for rel in files_to_update:
    path = os.path.join(base, rel)
    if not os.path.exists(path):
        print(f"SKIP (not found): {rel}")
        continue
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    new = content.replace("0.0005", "0.00015").replace("0.0002", "0.0001")
    if new != content:
        with open(path, "w", encoding="utf-8") as f:
            f.write(new)
        print(f"UPDATED: {rel}")
    else:
        print(f"NO CHANGE: {rel}")
