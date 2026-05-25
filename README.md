# 超级一号 (Quant Gate MVP)

加密货币量化交易系统 — 支持策略开发、回测、模拟盘与 Gate.io 实盘合约交易。

## 功能

- **多策略引擎**：经典策略（布林带 + RSI + MA + MACD + KDJ）和海龟策略（ATR + ADX）
- **模拟交易**：基于 PaperBroker 的零风险模拟，完整模拟滑点与手续费
- **实盘交易**：Gate.io USDT 永续合约，HMAC 签名认证，加密存储 API Key
- **自动 Runner**：定时策略循环，实时盯市即时止损止盈
- **风控系统**：连续亏损限制、单日亏损比、总暴露比，自动暂停
- **回测引擎**：支持时间窗口回测，含滑点/手续费模拟
- **实时仪表盘**：深色主题工作台，策略控制、持仓监控、权益曲线

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Next.js 15, React, TypeScript, Tailwind CSS |
| 后端 | Python 3.11+, FastAPI |
| 数据库 | SQLite |
| 数据分析 | Pandas, NumPy |

## 项目结构

```
quant-gate-mvp/
├── apps/
│   ├── api/                    # Python FastAPI 后端
│   │   ├── app/
│   │   │   ├── api/           # API 路由
│   │   │   ├── core/          # 配置、状态管理、日志
│   │   │   ├── paper/         # 模拟交易 Broker
│   │   │   ├── services/      # 业务逻辑（策略执行、风控、数据）
│   │   │   └── strategy/      # 交易策略算法
│   │   └── tests/             # 集成测试
│   └── web/                    # Next.js 前端
│       ├── app/               # 页面
│       └── components/        # 组件
├── infra/                     # Docker 配置
├── state/                     # 运行时数据（SQLite + JSON）
└── .env.example               # 环境变量模板
```

## 快速开始

### 1. 配置环境变量

```bash
cp .env.example .env
```

### 2. 启动后端

```bash
cd apps/api
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

API 文档：http://localhost:8000/docs

### 3. 启动前端

```bash
cd apps/web
npm install
npm run dev --port 3000
```

仪表盘：http://localhost:3000

### 4. 运行测试

```bash
cd apps/api
python tests/test_integration_chain.py -v
```

## 实盘交易

1. 在 Gate.io 创建合约 API Key
2. 在仪表盘「合约实盘账户」页面输入 Key（AES 加密存储在本地 SQLite）
3. 在策略控制台将交易模式切换为 `live`
4. 启动 Runner

## 风险提示

本项目仅供学习研究使用。加密货币交易存在高风险，不要投入超过你能承受损失的资金。先用模拟盘充分测试策略。
