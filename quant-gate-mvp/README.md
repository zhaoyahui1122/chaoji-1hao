# 超级一号 (Quant Gate MVP)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python 3.11+](https://img.shields.io/badge/Python-3.11+-blue.svg)](https://www.python.org/downloads/)
[![Node.js 18+](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)

> 🚀 CryptoQuant AI — 先进的开源量化交易平台，弥合算法市场执行与人工智能之间的鸿沟

## 📌 项目简介

**超级一号（Quant Gate MVP）** 是一个全栈加密货币量化交易系统，专为专业交易者和开发者设计。项目采用现代化技术栈，提供完整的策略开发、回测、实盘交易和实时监控能力。

### 核心特性

- 🤖 **AI 驱动策略** — 集成多种量化交易策略（海龟交易、均值回归、ADX趋势等）
- 📊 **实时仪表盘** — 基于 Next.js 的响应式前端，实时展示交易数据和性能指标
- 🔄 **自动交易引擎** — Python FastAPI 后端，支持实盘和模拟交易
- 📈 **策略回测系统** — 完整的历史数据回测框架，支持参数网格搜索优化
- 🛡️ **风险管理** — 内置止损、止盈、仓位管理等风险控制机制
- 📱 **多交易所支持** — 通过 CCXT 库支持主流加密货币交易所

## 🏗️ 技术架构

```
┌─────────────────────────────────────────────────────────────┐
│                      量化交易系统架构                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │   前端仪表盘  │◄───│   API 网关   │◄───│  交易引擎    │  │
│  │  (Next.js)   │    │  (FastAPI)   │    │  (Python)    │  │
│  └──────────────┘    └──────────────┘    └──────────────┘  │
│         │                   │                   │          │
│         ▼                   ▼                   ▼          │
│  ┌─────────────────────────────────────────────────────┐  │
│  │                    数据层                            │  │
│  │  SQLite │ CCXT │ WebSocket │ 历史K线数据            │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| **前端** | Next.js 15, React, TypeScript, Tailwind CSS | 响应式仪表盘界面 |
| **后端** | Python 3.11+, FastAPI, SQLAlchemy | 高性能异步API服务 |
| **数据库** | SQLite (可扩展至 PostgreSQL) | 轻量级本地存储 |
| **交易所** | CCXT | 统一的交易所API接口 |
| **实时通信** | WebSocket | 实时行情推送和交易通知 |
| **回测** | Pandas, NumPy | 数据分析和策略回测 |

## 📁 项目结构

```
quant-gate-mvp/
├── apps/
│   ├── api/                    # Python FastAPI 后端服务
│   │   ├── app/
│   │   │   ├── api/           # API 路由
│   │   │   ├── backtest/      # 回测引擎
│   │   │   ├── core/          # 核心配置
│   │   │   ├── models/        # 数据模型
│   │   │   ├── paper/         # 模拟交易
│   │   │   ├── schemas/       # Pydantic 模式
│   │   │   ├── services/      # 业务逻辑
│   │   │   ├── strategy/      # 交易策略
│   │   │   └── ws/            # WebSocket 处理
│   │   ├── Dockerfile         # Docker 容器配置
│   │   └── requirements.txt   # Python 依赖
│   │
│   └── web/                    # Next.js 前端应用
│       ├── app/               # App Router 页面
│       ├── components/        # React 组件
│       ├── lib/               # 工具函数
│       └── tests/             # E2E 测试
│
├── packages/
│   └── shared/                # 共享类型和工具
│
├── docs/                      # 项目文档
├── infra/                     # 基础设施配置
├── state/                     # 状态管理
│
├── *.py                       # Python 测试和工具脚本
├── *.ps1                      # PowerShell 启动脚本
│
├── start-api.ps1             # 启动 API 服务
├── start-web.ps1             # 启动 Web 服务
├── start-dev.ps1             # 启动开发环境
└── stop-dev.ps1              # 停止开发环境
```

## 🚀 快速开始

### 前置要求

- **Python** 3.11 或更高版本
- **Node.js** 18 或更高版本
- **pnpm** (推荐) 或 npm
- 交易所 API 密钥（用于实盘交易）

### 1. 克隆项目

```bash
git clone https://github.com/zhaoyahui1122/chaoji-1hao.git
cd chaoji-1hao
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env 文件，填入您的配置
```

环境变量说明：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `NEXT_PUBLIC_API_BASE` | `http://localhost:8000` | API 服务地址 |
| `DEFAULT_SYMBOL` | `BTC_USDT` | 默认交易对 |
| `DEFAULT_TIMEFRAME` | `15m` | 默认K线周期 |
| `DEFAULT_LEVERAGE` | `5` | 默认杠杆倍数 |
| `INITIAL_BALANCE` | `10000` | 初始模拟资金 |
| `DEFAULT_ALLOCATED_MARGIN` | `1000` | 默认分配保证金 |

### 3. 安装依赖

**后端 (API):**
```bash
cd apps/api
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

**前端 (Web):**
```bash
cd apps/web
pnpm install  # 或 npm install
```

### 4. 启动服务

**方式一：一键启动开发环境**
```powershell
# Windows PowerShell
powershell -ExecutionPolicy Bypass -File .\start-dev.ps1
```

**方式二：分别启动**

启动 API 服务：
```bash
cd apps/api
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

启动 Web 服务：
```bash
cd apps/web
pnpm dev --port 3000
```

### 5. 访问应用

- 🌐 **前端仪表盘**: http://localhost:3000
- 📡 **API 文档**: http://localhost:8000/docs
- 🔌 **API 服务**: http://localhost:8000

## 📊 交易策略

### 内置策略

1. **海龟交易策略 (Turtle Trading)**
   - 经典的趋势跟踪策略
   - 支持 ADX 过滤器
   - 可配置入场/出场周期

2. **均值回归策略 (Mean Reversion)**
   - 基于布林带的反转策略
   - 适合震荡市场

3. **网格交易策略 (Grid Trading)**
   - 自动化区间交易
   - 支持动态网格调整

4. **组合策略**
   - 多策略信号融合
   - 智能仓位分配

### 策略参数优化

项目提供完整的网格搜索优化工具：

```bash
# 运行网格搜索
python grid_search.py

# 查看优化结果
python grid_search2.py
```

## 📈 回测系统

### 运行回测

```bash
# 30天数据回测
python backtest_30d_15m.py

# 策略对比
python backtest_30d_compare.py
```

### 回测指标

- 📊 总收益率 / 年化收益率
- 📉 最大回撤
- 🎯 胜率 / 盈亏比
- 📈 夏普比率
- 🔄 交易次数 / 持仓时间

## 🔧 API 接口

### 核心端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/status` | 系统状态 |
| `GET` | `/api/positions` | 当前持仓 |
| `POST` | `/api/trade` | 执行交易 |
| `GET` | `/api/backtest` | 回测结果 |
| `WS` | `/ws/market` | 实时行情 |

详细 API 文档请访问: http://localhost:8000/docs

## 🐳 Docker 部署

```bash
# 构建镜像
docker build -t quant-gate-api -f apps/api/Dockerfile apps/api

# 运行容器
docker run -d -p 8000:8000 --name quant-gate-api quant-gate-api
```

## 📝 开发指南

### 代码规范

- Python: 遵循 PEP 8
- TypeScript: 使用 ESLint + Prettier
- 提交前运行 `pytest` 和 `pnpm lint`

### 测试

```bash
# Python 测试
cd apps/api
pytest

# Web 测试
cd apps/web
pnpm test
```

### 项目脚本

| 脚本 | 说明 |
|------|------|
| `start-api.ps1` | 启动 API 服务 |
| `start-web.ps1` | 启动 Web 服务 |
| `start-dev.ps1` | 启动完整开发环境 |
| `stop-dev.ps1` | 停止所有服务 |
| `turtle_optimize.ps1` | 运行海龟策略优化 |

## ⚠️ 风险提示

> **重要声明**: 本项目仅供学习和研究使用。加密货币交易存在高风险，请在充分了解风险的情况下使用。开发者不对任何资金损失负责。

- 🚫 不要投入超过您能承受损失的资金
- 🧪 先使用模拟交易（Paper Trading）测试策略
- 📚 充分理解每个策略的运作原理
- 🔒 保护好您的 API 密钥，不要分享给他人

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 打开 Pull Request

## 📄 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件

## 🙏 致谢

- [CCXT](https://github.com/ccxt/ccxt) - 统一的加密货币交易库
- [FastAPI](https://fastapi.tiangolo.com/) - 现代 Python Web 框架
- [Next.js](https://nextjs.org/) - React 应用框架
- [Tailwind CSS](https://tailwindcss.com/) - 实用优先的 CSS 框架

## 📧 联系方式

- GitHub: [@zhaoyahui1122](https://github.com/zhaoyahui1122)
- 项目地址: [https://github.com/zhaoyahui1122/chaoji-1hao](https://github.com/zhaoyahui1122/chaoji-1hao)

---

**超级一号** — 让量化交易更简单 🚀
