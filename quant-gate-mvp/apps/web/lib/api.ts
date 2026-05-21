import type {
  BacktestResult,
  DashboardData,
  EquityPoint,
  HistoryOrder,
  HistoryPosition,
  HistoryStats,
  RunnerInvocationResult,
  RunnerLogItem,
  StrategyConfig,
  StrategySlotPreset,
} from '../components/dashboard-types'

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:8012'
const API_KEY = process.env.NEXT_PUBLIC_API_KEY || ''

function apiHeaders(extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = { ...extra }
  if (API_KEY) h['X-API-Key'] = API_KEY
  return h
}

export type CandleItem = {
  timestamp: number
  volume: number
  close: number
  high: number
  low: number
  open: number
}

export type MarketTicker = {
  symbol: Symbol
  last_price: number
  mark_price: number
  index_price: number
  funding_rate: number
  volume_24h: number
  raw?: Record<string, unknown>
}

export type Symbol = 'BTC_USDT' | 'ETH_USDT'
export type Timeframe = '5m' | '15m' | '30m' | '1h' | '4h'
export type DataSource = 'mock' | 'gate'

export type StrategyResponse = StrategyConfig

export type RunnerLogsResponse = {
  items: RunnerLogItem[]
}

export type EquityCurveResponse = {
  items: EquityPoint[]
}

export type OrderHistoryResponse = {
  items: HistoryOrder[]
}

export type PositionHistoryResponse = {
  items: HistoryPosition[]
}

export type PaperTradePayload = {
  symbol: Symbol
  side: 'long' | 'short'
  price: number
  leverage: number
  allocated_margin: number
  stop_loss_price: number
  qty?: number
  risk_per_trade_pct?: number
  stop_loss_pct?: number
  take_profit_pct?: number
  fee_rate?: number
  slippage_rate?: number
}

export type PaperMarkPayload = {
  symbol: Symbol
  mark_price: number
  position_id?: string
}

export type PaperClosePayload = {
  symbol: Symbol
  price: number
  position_id?: string
}

export type StrategySavePayload = StrategyConfig

export type BacktestRequestPayload = {
  symbol: Symbol
  timeframe: Timeframe
  strategy_type: 'classic' | 'turtle' | 'ict'
  data_source: DataSource
  leverage: number
  initial_balance: number
  allocated_margin: number
  fee_rate: number
  slippage_rate: number
  entry_price: number
  stop_loss_price: number
  backtest_days?: number
  use_boll?: boolean
  boll_period: number
  boll_std: number
  use_rsi?: boolean
  rsi_period: number
  rsi_oversold?: number
  rsi_overbought?: number
  use_ma?: boolean
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
}

export type RunnerRequestPayload = {
  symbol: Symbol
  symbols?: Symbol[] | null
  timeframe: Timeframe
  strategy_type: 'classic' | 'turtle' | 'ict'
  data_source: DataSource
  leverage: number
  allocated_margin: number
  use_boll?: boolean
  boll_period: number
  boll_std: number
  use_rsi?: boolean
  rsi_period: number
  rsi_oversold: number
  rsi_overbought: number
  use_ma?: boolean
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
  stop_loss_pct: number
  take_profit_pct: number
  risk_per_trade_pct: number
  fee_rate: number
  slippage_rate: number
}

export type RunnerStatusResponse = {
  enabled: boolean
  is_running: boolean
  loop_count: number
  last_run_at: string | null
  last_result: RunnerInvocationResult['result'] | null
  last_error: string | null
  halt_reason: string | null
  next_run_eta?: number | null
  manual_resume_required?: boolean
  last_executed_candle_eta?: number | null
  selected_symbols?: Symbol[] | null
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
  }
}

export type RunnerToggleResponse = {
  ok: boolean
  enabled: boolean
  status: RunnerStatusResponse
}

export type RunnerResumeResponse = {
  ok: boolean
  status: RunnerStatusResponse
}

export type PaperSnapshotResponse = Pick<DashboardData, 'account' | 'positions' | 'orders'>

export type PaperOrderResponse = {
  ok: boolean
  order?: HistoryOrder | Record<string, unknown>
  risk?: Record<string, unknown>
  execution_price?: number
  fee?: number
  slippage_rate?: number
  reason?: string
}

export type PaperMarkResponse = {
  ok: boolean
  symbol?: string
  reason?: string
  event?: {
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
  snapshot?: PaperSnapshotResponse
}

export type PaperCloseResponse = {
  ok: boolean
  symbol?: string
  reason?: string
  pnl?: number
  gross_pnl?: number
  fee?: number
  execution_price?: number
  closed?: Record<string, unknown>
  closed_row?: Record<string, unknown> | null
  event?: {
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
  snapshot?: PaperSnapshotResponse
}

export type PaperHistoryFilters = {
  symbol?: string
  status?: string
  event_type?: string
  source?: string
  start_time?: string
  end_time?: string
  trade_mode?: string
}

function buildQuery(params: Record<string, string | number | undefined | null>) {

  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    search.set(key, String(value))
  }
  const query = search.toString()
  return query ? `?${query}` : ''
}

export async function getDashboard(): Promise<DashboardData> {

  const res = await fetch(`${API_BASE}/dashboard`, { cache: 'no-store', headers: apiHeaders() })
  if (!res.ok) throw new Error('Failed to load dashboard')
  return res.json()
}

export async function getMarketTicker(symbol: Symbol): Promise<MarketTicker> {

  const res = await fetch(`${API_BASE}/market/ticker/${symbol}`, { cache: 'no-store', headers: apiHeaders() })
  if (!res.ok) throw new Error('Failed to load market ticker')
  return res.json()
}

export async function getMarketCandles(symbol: Symbol, timeframe: Timeframe, limit = 120): Promise<{ symbol: Symbol; timeframe: Timeframe; items: CandleItem[] }> {

  const res = await fetch(`${API_BASE}/market/candles/${symbol}?timeframe=${timeframe}&limit=${limit}`, { cache: 'no-store', headers: apiHeaders() })
  if (!res.ok) throw new Error('Failed to load market candles')
  return res.json()
}

export async function getStrategy(): Promise<StrategyResponse> {

  const res = await fetch(`${API_BASE}/strategy`, { cache: 'no-store', headers: apiHeaders() })
  if (!res.ok) throw new Error('Failed to load strategy')
  return res.json()
}

export async function saveStrategy(payload: StrategySavePayload): Promise<StrategyResponse> {

  const res = await fetch(`${API_BASE}/strategy`, {
    method: 'POST',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error('Failed to save strategy')
  const data = await res.json()
  return data.config ?? data
}

export async function runBacktest(payload: BacktestRequestPayload): Promise<BacktestResult> {

  const res = await fetch(`${API_BASE}/backtest`, {
    method: 'POST',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error('Failed to run backtest')
  return res.json()
}

export async function runStrategyOnce(payload: RunnerRequestPayload): Promise<RunnerInvocationResult> {

  const res = await fetch(`${API_BASE}/runner/run-once`, {
    method: 'POST',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error('Failed to run strategy once')
  return res.json()
}

export async function getRunnerLogs(): Promise<RunnerLogsResponse> {

  const res = await fetch(`${API_BASE}/runner/logs`, { cache: 'no-store', headers: apiHeaders() })
  if (!res.ok) throw new Error('Failed to load runner logs')
  return res.json()
}

export async function getRunnerStatus(): Promise<RunnerStatusResponse> {

  const res = await fetch(`${API_BASE}/runner/status`, { cache: 'no-store', headers: apiHeaders() })
  if (!res.ok) throw new Error('Failed to load runner status')
  return res.json()
}

export async function toggleRunner(enabled: boolean, symbols?: Symbol[] | null, tradeMode?: 'paper' | 'live'): Promise<RunnerToggleResponse> {

  const res = await fetch(`${API_BASE}/runner/toggle`, {
    method: 'POST',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ enabled, symbols, trade_mode: tradeMode || 'paper' }),
  })
  if (!res.ok) throw new Error('Failed to toggle runner')
  return res.json()
}

export async function resumeRunner(): Promise<RunnerResumeResponse> {

  const res = await fetch(`${API_BASE}/runner/resume`, {
    method: 'POST',
    headers: apiHeaders(),
  })
  if (!res.ok) throw new Error('Failed to resume runner')
  return res.json()
}

export async function resetPaperAccount(initialBalance: number): Promise<{ ok: boolean }> {
  const res = await fetch(`${API_BASE}/paper/reset-custom`, {
    method: 'POST',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ initial_balance: initialBalance }),
  })
  if (!res.ok) throw new Error('Failed to reset paper account')
  return res.json()
}

export async function getPaperSnapshot(): Promise<PaperSnapshotResponse> {

  const res = await fetch(`${API_BASE}/paper/snapshot`, { cache: 'no-store', headers: apiHeaders() })
  if (!res.ok) throw new Error('Failed to load paper snapshot')
  return res.json()
}

export async function getEquityCurve(limit = 100, tradeMode?: string): Promise<EquityCurveResponse> {
  const query = buildQuery({ limit, trade_mode: tradeMode })
  const res = await fetch(`${API_BASE}/history/equity-curve${query}`, { cache: 'no-store', headers: apiHeaders() })
  if (!res.ok) throw new Error('Failed to load equity curve')
  return res.json()
}

export async function getOrderHistory(
  limit = 100,
  filters?: PaperHistoryFilters
): Promise<OrderHistoryResponse> {

  const query = buildQuery({ limit, ...filters })
  const res = await fetch(`${API_BASE}/history/orders${query}`, { cache: 'no-store', headers: apiHeaders() })
  if (!res.ok) throw new Error('Failed to load order history')
  return res.json()
}

export async function getPositionHistory(
  limit = 100,
  filters?: { symbol?: string; status?: string; start_time?: string; end_time?: string; trade_mode?: string }
): Promise<PositionHistoryResponse> {

  const query = buildQuery({ limit, ...filters })
  const res = await fetch(`${API_BASE}/history/positions${query}`, { cache: 'no-store', headers: apiHeaders() })
  if (!res.ok) throw new Error('Failed to load position history')
  return res.json()
}

export async function getHistoryStats(tradeMode?: string): Promise<HistoryStats> {
  const query = buildQuery({ trade_mode: tradeMode })
  const res = await fetch(`${API_BASE}/history/stats${query}`, { cache: 'no-store', headers: apiHeaders() })
  if (!res.ok) throw new Error('Failed to load history stats')
  return res.json()
}

export async function placePaperOrder(payload: PaperTradePayload): Promise<PaperOrderResponse> {


  const res = await fetch(`${API_BASE}/paper/order`, {
    method: 'POST',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error('Failed to place paper order')
  return res.json()
}

export async function updatePaperMark(payload: PaperMarkPayload): Promise<PaperMarkResponse> {


  const res = await fetch(`${API_BASE}/paper/mark`, {
    method: 'POST',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error('Failed to update mark price')
  return res.json()
}

export async function closePaperPosition(payload: PaperClosePayload): Promise<PaperCloseResponse> {


  const res = await fetch(`${API_BASE}/paper/close`, {
    method: 'POST',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error('Failed to close paper position')
  return res.json()
}

// ==================== 策略槽 API ====================

export type StrategySlotsResponse = {
  slots: StrategySlotPreset[]
}

export type StrategySlotAddResponse = {
  ok: boolean
  slot: StrategySlotPreset
}

export type StrategySlotActionResponse = {
  ok: boolean
  message: string
}

export async function getStrategySlots(): Promise<StrategySlotsResponse> {
  const res = await fetch(`${API_BASE}/strategy/slots`, { cache: 'no-store', headers: apiHeaders() })
  if (!res.ok) throw new Error('Failed to load strategy slots')
  return res.json()
}

export async function addStrategySlot(name?: string): Promise<StrategySlotAddResponse> {
  const res = await fetch(`${API_BASE}/strategy/slots/add`, {
    method: 'POST',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw new Error('Failed to add strategy slot')
  return res.json()
}

export async function updateStrategySlotName(slotId: number, name: string): Promise<StrategySlotActionResponse> {
  const res = await fetch(`${API_BASE}/strategy/slots/${slotId}/name`, {
    method: 'POST',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ name }),
  })
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: 'Failed to update slot name' }))
    throw new Error(error.detail || 'Failed to update slot name')
  }
  return res.json()
}

export async function updateStrategySlotConfig(slotId: number, config: StrategyConfig): Promise<StrategySlotActionResponse> {
  const res = await fetch(`${API_BASE}/strategy/slots/${slotId}/config`, {
    method: 'POST',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(config),
  })
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: 'Failed to update slot config' }))
    throw new Error(error.detail || 'Failed to update slot config')
  }
  return res.json()
}

export async function deleteStrategySlot(slotId: number): Promise<StrategySlotActionResponse> {
  const res = await fetch(`${API_BASE}/strategy/slots/${slotId}`, {
    method: 'DELETE',
    headers: apiHeaders(),
  })
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: 'Failed to delete slot' }))
    throw new Error(error.detail || 'Failed to delete slot')
  }
  return res.json()
}

// ==================== Live Account API ====================

export type LiveAccountPosition = {
  symbol: string
  side: 'long' | 'short'
  leverage: number
  size: number
  entry_price: number
  mark_price: number
  unrealized_pnl: number
}

export type LiveAccountOverview = {
  equity: number
  available_balance: number
  margin_used: number
  unrealized_pnl: number
}

export type LiveAccountStatus = {
  connected: boolean
  has_credentials: boolean
  last_sync_at: string | null
  last_error: string | null
  account: LiveAccountOverview | null
  positions: LiveAccountPosition[]
  source: string
}

export async function getLiveAccountStatus(): Promise<LiveAccountStatus> {
  const res = await fetch(`${API_BASE}/live-account/status`, { cache: 'no-store', headers: apiHeaders() })
  if (!res.ok) throw new Error('Failed to load live account status')
  return res.json()
}

export async function connectLiveAccount(api_key: string, api_secret: string): Promise<LiveAccountStatus> {
  const res = await fetch(`${API_BASE}/live-account/connect`, {
    method: 'POST',
    headers: apiHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ api_key, api_secret }),
  })
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: '连接失败' }))
    throw new Error(error.detail || '连接失败')
  }
  return res.json()
}

export async function refreshLiveAccount(): Promise<LiveAccountStatus> {
  const res = await fetch(`${API_BASE}/live-account/refresh`, {
    method: 'POST',
    headers: apiHeaders(),
  })
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: '刷新失败' }))
    throw new Error(error.detail || '刷新失败')
  }
  return res.json()
}

export type ContractInfo = {
  contract: string
  leverage_min: string
  leverage_max: string
  order_size_min?: string
  order_size_max?: string
  mark_price?: string
  index_price?: string
}

export async function getContractInfo(symbol: string): Promise<ContractInfo> {
  const res = await fetch(`${API_BASE}/live-account/contract/${symbol}`, { cache: 'no-store', headers: apiHeaders() })
  if (!res.ok) throw new Error('Failed to load contract info')
  return res.json()
}

// ==================== 策略快照 API ====================

export type StrategySnapshot = {
  id: number
  label: string | null
  created_at: string
}

export async function getStrategySnapshots(limit = 20): Promise<{ snapshots: StrategySnapshot[] }> {
  const res = await fetch(`${API_BASE}/strategy/snapshots?limit=${limit}`, { cache: 'no-store', headers: apiHeaders() })
  if (!res.ok) throw new Error('Failed to load snapshots')
  return res.json()
}

export async function rollbackStrategy(snapshotId: number): Promise<{ ok: boolean; message: string; config: StrategyConfig }> {
  const res = await fetch(`${API_BASE}/strategy/rollback/${snapshotId}`, {
    method: 'POST',
    headers: apiHeaders(),
  })
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: 'Rollback failed' }))
    throw new Error(error.detail || 'Rollback failed')
  }
  return res.json()
}

// ==================== 导出 API ====================

export function exportTradesUrl(mode: 'paper' | 'live' = 'paper', format: 'csv' | 'json' = 'csv'): string {
  return `${API_BASE}/export/trades?mode=${mode}&format=${format}`
}

export async function getExportSummary(mode: 'paper' | 'live' = 'paper'): Promise<Record<string, unknown>> {
  const res = await fetch(`${API_BASE}/export/summary?mode=${mode}`, { cache: 'no-store', headers: apiHeaders() })
  if (!res.ok) throw new Error('Failed to load export summary')
  return res.json()
}
