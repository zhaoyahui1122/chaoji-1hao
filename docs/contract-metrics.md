# 合约指标与风控口径说明

## 合约UI核心指标
前端应优先展示以下字段：

- 账户权益（Account Equity）
- 可用余额（Available Balance）
- 保证金占用（Margin Used）
- 保证金率（Margin Ratio）
- 未实现盈亏（Unrealized PnL）
- 已实现盈亏（Realized PnL，后续接入）
- 杠杆倍数（Leverage，UI 可调范围 1-100）
- 仓位方向（Long/Short）
- 持仓数量（Qty）
- 开仓价（Entry Price）
- 标记价（Mark Price）
- 名义价值（Notional）
- 预估强平价（Estimated Liquidation Price）
- 交易周期（5m / 15m / 30m / 1h / 4h）

## 计算口径（MVP简化版）
### 1. 名义价值
notional = mark_price * qty

### 2. 初始保证金
initial_margin = notional / leverage

### 3. 未实现盈亏
#### 多头
unrealized_pnl = (mark_price - entry_price) * qty

#### 空头
unrealized_pnl = (entry_price - mark_price) * qty

### 4. 保证金率（简化展示口径）
margin_ratio = margin_used / account_equity

> 后续若接入 Gate 官方更精确口径，可替换成交易所标准风险率公式。

### 5. 单笔最大亏损（必须结合杠杆与止损）
核心不是只看保证金，而是看：

max_loss = abs(entry_price - stop_loss_price) * qty

其中 qty 往往由杠杆间接放大，因为：

qty = (account_allocated_margin * leverage) / entry_price

所以等价地：
- 杠杆越高
- 同样投入保证金下，可开仓数量越大
- 若止损距离不变，则单笔最大亏损也会被放大

### 6. 风控准入条件（建议）
下单前要求同时满足：

- initial_margin <= available_balance * margin_limit_ratio
- max_loss <= account_equity * max_loss_ratio
- total_open_notional <= account_equity * total_exposure_ratio

## MVP建议默认参数
- leverage: UI 允许 1x - 100x
- single_trade_margin_limit_ratio: 0.2
- single_trade_max_loss_ratio: 0.01 ~ 0.02
- total_exposure_ratio: 1.5
- daily_loss_limit_ratio: 0.03
- supported_timeframes:
  - 5m
  - 15m
  - 30m
  - 1h
  - 4h

## 说明
MVP 阶段先用“可解释、可验证”的简化风控公式；
等接入真实 Gate 合约账户后，再对齐交易所实际字段与强平/风险率口径。
