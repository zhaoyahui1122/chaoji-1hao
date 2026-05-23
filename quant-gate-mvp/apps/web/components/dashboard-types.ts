import type React from 'react'

export type DashboardRunner = {
  enabled: boolean
  is_running: boolean
  trade_mode?: 'paper' | 'live'
  loop_count: number
  last_run_at: string | null
  last_result: RunnerExecutionResult | null
  last_error: string | null
  halt_reason: string | null
  next_run_eta?: number | null
  manual_resume_required?: boolean
  last_executed_candle_eta?: number | null
  selected_symbols?: Array<'BTC_USDT' | 'ETH_USDT'> | null
  last_config?: Record<string, unknown> | null
  last_run_config?: Record<string, unknown> | null
  current_strategy_config?: Record<string, unknown> | null
  guard?: {
    allowed: boolean
    halt_reason: string | null
    consecutive_loss_count: number
    daily_realized_pnl: number
    daily_loss_ratio: number
    total_notional: number
    exposure_ratio: number
    current_drawdown_pct?: number
    trades_per_hour?: number
    trades_per_day?: number
    max_trades_per_hour?: number
    max_trades_per_day?: number
  }
}

export type MarketTickers = Record<'BTC_USDT' | 'ETH_USDT', { last_price: number; mark_price: number } | null>

export type DashboardData = {
  account: {
    equity: number
    available_balance: number
    margin_used: number
    margin_ratio: number
    unrealized_pnl: number
    realized_pnl: number
    open_positions: number
    total_notional: number
    exposure_ratio: number
    max_drawdown_pct?: number
    current_drawdown_pct?: number
    peak_equity?: number
  }
  positions: Array<{
    position_id?: string | null
    symbol: string
    side: 'long' | 'short'
    leverage: number
    qty: number
    entry_price: number
    mark_price: number
    notional: number
    initial_margin: number
    margin_used: number
    maintenance_margin: number
    unrealized_pnl: number
    pnl_return_ratio: number
    margin_ratio: number
    liquidation_price: number
    liquidation_distance_ratio: number
    stop_loss_price?: number | null
    take_profit_price?: number | null
    margin?: number
    liq_price?: number
    open_order_meta_json?: string | null
  }>
  orders?: Array<{
    position_id?: string | null
    symbol: string
    side: string
    price: number
    qty: number
    status: string
    event_type?: string
    source?: string
    meta_json?: string | null
  }>
  runner?: DashboardRunner
  trade_mode?: 'paper' | 'live'
  supported_symbols: string[]
  supported_timeframes: string[]
  defaults?: Record<string, unknown>
}

export type StrategyConfig = {
  symbol: 'BTC_USDT' | 'ETH_USDT'
  symbols?: Array<'BTC_USDT' | 'ETH_USDT'>
  timeframe: '5m' | '15m' | '30m' | '1h' | '4h'
  strategy_type: 'classic' | 'turtle' | 'ict'
  leverage: number
  use_boll: boolean
  boll_period: number
  boll_std: number
  use_rsi: boolean
  rsi_period: number
  rsi_oversold: number
  rsi_overbought: number
  use_ma: boolean
  ma_short: number
  ma_long: number
  use_macd?: boolean
  macd_fast?: number
  macd_slow?: number
  macd_signal?: number
  use_kdj?: boolean
  kdj_period?: number
  kdj_signal_period?: number
  kdj_overbought?: number
  kdj_oversold?: number
  min_signal_score?: number
  churn_guard_enabled?: boolean
  turtle_entry_period: number
  turtle_exit_period: number
  turtle_atr_period: number
  turtle_atr_filter: number
  turtle_adx_period?: number
  turtle_adx_threshold?: number
  turtle_force_mode?: string | null
  ict_bos_lookback?: number
  ict_risk_reward?: number
  ict_lookback_eng_bars?: number
  ict_min_fvg_width_pct?: number
  ict_cooldown_bars?: number
  ict_require_trend?: boolean
  stop_loss_pct: number
  take_profit_pct: number
  risk_per_trade_pct: number
  fee_rate: number
  slippage_rate: number
  enabled: boolean
}


export type StrategySlotPreset = {
  slotId: number
  name: string
  config: StrategyConfig
  updatedAt: string
  locked?: boolean
}

export type StrategyPriceReference = {
  symbol: 'BTC_USDT' | 'ETH_USDT'
  timeframe: '5m' | '15m' | '30m' | '1h' | '4h'
  live_price: number
  mark_price: number
  default_entry_price: number
  derived_stop_loss_price: number
  derived_take_profit_price: number
  stop_loss_pct: number
  take_profit_pct: number
}

export type EquityPoint = {
  id: number
  equity: number
  realized_pnl: number
  unrealized_pnl: number
  margin_used: number
  open_positions: number
  created_at: string
}

export type HistoryOrder = {
  id: number
  position_id?: string | null
  symbol: string
  side: string
  price: number
  qty: number
  status: string
  event_type?: string
  source?: string
  meta_json?: string | null
  created_at: string
}

export type HistoryPosition = {
  id: number
  position_id?: string | null
  symbol: string
  side: string
  leverage: number
  qty: number
  entry_price: number
  mark_price: number
  fee_rate?: number
  slippage_rate?: number
  entry_fee?: number
  cumulative_fees?: number
  entry_slippage_cost?: number
  exit_slippage_cost?: number
  cumulative_slippage_cost?: number
  open_meta_json?: string | null
  status: string
  opened_at: string
  closed_at?: string | null
  close_price?: number | null
  realized_pnl?: number | null
  gross_realized_pnl?: number | null
  total_fees?: number | null
  entry_notional?: number | null
  margin_basis?: number | null
  pnl_rate_on_notional?: number | null
  pnl_rate_on_margin?: number | null
  gross_pnl_rate_on_notional?: number | null
  gross_pnl_rate_on_margin?: number | null
}

export type CostSummary = {
  gross_pnl: number
  fees: number
  slippage_cost: number
  net_pnl: number
}

export type HistoryStats = CostSummary & {
  total_trades: number
  win_trades: number
  loss_trades: number
  win_rate: number
  avg_pnl_per_trade: number
  avg_fee_per_trade: number
  avg_slippage_cost_per_trade: number
  max_profit_trade: number
  max_loss_trade: number
  max_drawdown_ratio: number
  equity_points: number
  total_gross_realized_pnl: number
  total_fees: number
  total_slippage_cost: number
  total_realized_pnl: number
}

export type BacktestTrade = {
  side: string
  entry_time: string
  exit_time: string
  entry_price: number
  exit_price: number
  qty: number
  gross_pnl: number
  fee: number
  pnl: number
  pnl_pct: number
  reason: string
  entry_slippage: number
  exit_slippage: number
  leverage?: number
  status?: string
  cumulative_fees?: number
  cumulative_slippage_cost?: number
}

export type BacktestSummary = CostSummary & {
  return_pct: number
  max_drawdown_pct: number
  win_rate_pct: number
  trades: number
  ending_equity: number
  total_gross_pnl: number
  total_fees: number
  total_slippage_cost: number
  total_net_pnl: number
}

export type BacktestInput = {
  data_source?: string
  symbol?: string
  timeframe?: string
  strategy_type?: 'classic' | 'turtle'
  leverage?: number
  initial_balance?: number
  allocated_margin?: number
  fee_rate?: number
  slippage_rate?: number
  entry_price?: number
  stop_loss_price?: number
  backtest_days?: number
  use_boll?: boolean
  boll_period?: number
  boll_std?: number
  use_rsi?: boolean
  rsi_period?: number
  rsi_oversold?: number
  rsi_overbought?: number
  use_ma?: boolean
  ma_short?: number
  ma_long?: number
  use_macd?: boolean
  macd_fast?: number
  macd_slow?: number
  macd_signal?: number
  use_kdj?: boolean
  kdj_period?: number
  kdj_signal_period?: number
  kdj_overbought?: number
  kdj_oversold?: number
  turtle_entry_period?: number
  turtle_exit_period?: number
  turtle_atr_period?: number
  turtle_atr_filter?: number
  stop_loss_pct?: number
  take_profit_pct?: number
  risk_per_trade_pct?: number
  [key: string]: unknown
}

export type BacktestRisk = {
  allowed: boolean
  leverage: number
  initial_margin: number
  max_loss: number
  equity_risk_ratio: number
  [key: string]: unknown
}

export type MarketDataMeta = {
  requested_source: string
  actual_source: string
  fallback_used: boolean
  warning?: string | null
}

export type BacktestResult = {
  ok: boolean
  input: BacktestInput
  market_data: MarketDataMeta & Record<string, unknown>
  risk: BacktestRisk
  summary: BacktestSummary
  equity_curve: Array<{ timestamp: string; equity: number }>
  trades: BacktestTrade[]
}

export type RunnerEvent = {
  position_id?: string | null
  symbol: string
  side: string
  price: number
  qty: number
  status: string
  event_type?: string
  source?: string
  meta_json?: string | null
}

export type RunnerExecutionResult = {
  signal?: string | number | null
  price?: number | null
  action?: string | null
  reason?: string | null
  market_data?: (MarketDataMeta & Record<string, unknown>) | null
  event?: RunnerEvent | null
  order?: RunnerEvent | null
  [key: string]: unknown
}

export type RunnerInvocationResult = {
  result?: RunnerExecutionResult | null
  [key: string]: unknown
}

export type RunnerLogItem = {
  ts: string
  config?: {
    symbol?: string
    timeframe?: string
    strategy_type?: 'classic' | 'turtle'
    [key: string]: unknown
  }
  result?: RunnerExecutionResult | null
  [key: string]: unknown
}

export type HistoryFilters = {
  symbol: string
  status: string
  event_type: string
  source: string
  start_time: string
  end_time: string
  trade_mode: string
}

export const surfaceStyle: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.18)',
  borderRadius: 24,
  background: 'linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(248,250,252,0.98) 100%)',
  boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)',
  backdropFilter: 'blur(10px)',
}

export const cardStyle: React.CSSProperties = {
  ...surfaceStyle,
  padding: 20,
}

export const compactCardStyle: React.CSSProperties = {
  ...surfaceStyle,
  padding: 18,
}

export const labelStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#64748b',
  marginBottom: 8,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
}

export const valueStyle: React.CSSProperties = {
  fontSize: 28,
  fontWeight: 800,
  letterSpacing: '-0.03em',
}

export const sectionTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 24,
  fontWeight: 800,
  letterSpacing: '-0.03em',
  color: '#0f172a',
}

export const sectionHintStyle: React.CSSProperties = {
  margin: '6px 0 0',
  color: '#64748b',
  fontSize: 13,
  lineHeight: 1.6,
}

export const metricCardStyle: React.CSSProperties = {
  ...compactCardStyle,
  display: 'grid',
  gap: 10,
  minHeight: 126,
}

export const metricValueLgStyle: React.CSSProperties = {
  fontSize: 30,
  fontWeight: 800,
  letterSpacing: '-0.04em',
  color: '#0f172a',
}

export const metricSubtleRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  alignItems: 'center',
  color: '#64748b',
  fontSize: 12,
}

export const chipStyle = (colors: { color: string; background: string }): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  borderRadius: 999,
  padding: '5px 10px',
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '0.01em',
  color: colors.color,
  background: colors.background,
})
