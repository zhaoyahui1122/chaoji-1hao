# Gate U本位合约模拟盘量化系统（MVP）

## 目标
构建一个可运行的自动量化交易系统 MVP，支持：
- Gate U本位合约
- 模拟盘/纸交易
- 策略：布林带 + RSI + 均线
- Web 控制台
- 回测与实时信号/持仓展示
- 基础风控

## 已确认需求
- 交易所：Gate
- 合约类型：U本位合约
- 模式：模拟盘
- 策略：布林带 + RSI + 均线
- 交易对：BTC_USDT、ETH_USDT
- K线周期：5m、15m、30m、1h、4h
- 杠杆：MVP 支持 1-100，在 UI 中可随时调整
- 前端需展示合约专属指标：
  - 未实现盈亏（Unrealized PnL）
  - 已实现盈亏（Realized PnL，后续补）
  - 保证金占用
  - 保证金率
  - 杠杆倍数
  - 强平价格（可先估算）
  - 仓位方向 / 张数 / 名义价值
- 风控要求：单笔最大亏损必须结合杠杆计算

## 范围（MVP）
### 前端
- 仪表盘：权益、可用余额、保证金占用、保证金率、未实现盈亏、持仓、订单、最近信号
- 策略页：参数配置、启停控制、交易对选择、周期选择、杠杆配置（1-100）
- 回测页：收益曲线、交易列表、指标摘要
- 日志页：系统日志、下单日志、风控事件
- 持仓卡片展示：
  - symbol
  - side
  - leverage
  - entry price
  - mark price
  - qty
  - notional
  - margin used
  - unrealized pnl
  - margin ratio
  - liquidation price（估算版）

### 后端
- FastAPI API
- Gate 模拟交易适配层（先抽象，MVP可先本地纸交易账户）
- 行情/K线采集
- 策略引擎
- 回测引擎
- 风控引擎（含杠杆风险计算）
- PostgreSQL 持久化
- Redis（缓存/任务状态，可后续启用）
- WebSocket 推送

### 策略逻辑（首版）
- 指标：
  - Bollinger Bands
  - RSI
  - EMA/SMA（短中周期）
- 交易标的：
  - BTC_USDT
  - ETH_USDT
- 周期：
  - 5m
  - 15m
  - 30m
  - 1h
  - 4h
- 多头示例信号：
  - 价格触及或跌破下轨
  - RSI 低于阈值后拐头
  - 短均线重新站上中均线
- 空头示例信号：
  - 价格触及或突破上轨
  - RSI 高于阈值后拐头
  - 短均线跌破中均线
- 出场：
  - 中轨/均线回归
  - 固定止损
  - 固定止盈
  - 信号反转

### 基础风控
- 单笔最大风险敞口
- 单日最大亏损限制
- 最大连续亏损停机
- 异常保护：交易通道异常/行情异常时停止下单
- 杠杆风控：
  - UI 可配置杠杆范围 1-100
  - 实际下单前仍需通过风险校验，不因高杠杆设置自动放行
  - 单笔最大亏损按“价格止损距离 × 仓位数量”计算，不以保证金本身误判风险
  - 下单前校验：
    - 名义价值 = price × qty
    - 初始保证金 ≈ 名义价值 / leverage
    - 预估最大亏损 = |entry - stop_loss| × qty
    - 风险占权益比 = 预估最大亏损 / account_equity
  - 若风险占权益比超过阈值，则禁止下单
  - 杠杆越高，同样保证金可开的名义价值越大，因此风险校验必须同时考虑杠杆与止损距离

## 技术栈
- Frontend: Next.js + Tailwind + shadcn/ui + echarts
- Backend: FastAPI + SQLAlchemy + Pydantic
- Data: PostgreSQL
- Realtime: WebSocket
- Strategy/Backtest: pandas + numpy
- Deployment: Docker Compose

## 目录规划
- quant-gate-mvp/
  - apps/web
  - apps/api
  - packages/shared
  - infra
  - docs

## 里程碑
1. 项目脚手架
2. 后端基础 API + 数据库模型
3. 策略/回测模块
4. 前端控制台
5. 模拟交易执行流
6. 联调与验证

## 风险提示
该系统后续若接入真实合约，需要额外完善：
- 真实交易所签名与限速
- 更严格风控
- 容灾与监控
- 密钥安全管理
- 手动确认与急停机制
