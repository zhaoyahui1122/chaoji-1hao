import type { ReactNode } from 'react'

import type {
  BacktestTrade,
  CostSummary,
  DashboardData,
  EquityPoint,
  HistoryOrder,
  MarketDataMeta,
  MarketTickers,
  RunnerExecutionResult,
  RunnerInvocationResult,
} from './dashboard-types'
import type { LiveAccountStatus } from '../lib/api'

function pad2(value: number) {
  return String(value).padStart(2, '0')
}

function formatLocalDateParts(date: Date) {
  return `${date.getFullYear()}/${pad2(date.getMonth() + 1)}/${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

export function formatUnixTs(ts?: number | null) {
  if (!ts) return '-'
  return formatLocalDateParts(new Date(ts * 1000))
}

export function formatDateTime(value?: string | null) {
  if (!value) return '-'
  const normalized = /z$/i.test(value) || /[+-]\d\d:\d\d$/.test(value)
    ? value
    : value.includes('T')
      ? `${value}Z`
      : `${value.replace(' ', 'T')}Z`
  const parsed = new Date(normalized)
  if (Number.isNaN(parsed.getTime())) return value
  return formatLocalDateParts(parsed)
}

export function formatMoney(value?: number | null) {
  return `$${Number(value || 0).toFixed(2)}`
}

export function formatPercent(value?: number | null) {
  if (value == null || Number.isNaN(Number(value))) return '-'
  return `${(Number(value) * 100).toFixed(2)}%`
}

export function formatMarketDataStatus(meta?: MarketDataMeta | null) {
  if (!meta) return '未知'
  return `${meta.requested_source} → ${meta.actual_source}${meta.fallback_used ? '（已回退）' : ''}`
}

export function parseMetaJson(metaJson?: string | null): Record<string, unknown> | null {
  if (!metaJson) return null
  try {
    return JSON.parse(metaJson) as Record<string, unknown>
  } catch {
    return null
  }
}

export function readPositionTargetPrice(
  metaJson: string | null | undefined,
  key: 'stop_loss_price' | 'take_profit_price',
): number | null {
  const meta = parseMetaJson(metaJson)
  const value = Number(meta?.[key])
  return Number.isFinite(value) ? value : null
}

export function renderRiskExecutionSummary(meta: Record<string, unknown>) {
  const rows: string[] = []

  const explicitQty = Number(meta.explicit_qty ?? 0)
  const hasRiskSizing = meta.risk_per_trade_pct !== undefined || meta.risk_based_allocated_margin !== undefined
  const hasExplicitQty = explicitQty > 0
  const sizingModeValue = String(meta.sizing_mode ?? '')
  const sizingMode = sizingModeValue === 'risk'
    ? '风险模式'
    : sizingModeValue === 'explicit_qty'
      ? '显式数量模式'
      : sizingModeValue === 'margin'
        ? '保证金模式'
        : hasRiskSizing
          ? '风险模式'
          : hasExplicitQty
            ? '显式数量模式'
            : '保证金模式'

  rows.push(`开仓模式 ${sizingMode}`)
  if (meta.close_reason) rows.push(`平仓原因 ${String(meta.close_reason)}`)
  if (meta.allocated_margin !== undefined) rows.push(`原始保证金 ${formatMoney(Number(meta.allocated_margin ?? 0))}`)
  if (meta.effective_allocated_margin !== undefined) rows.push(`生效保证金 ${formatMoney(Number(meta.effective_allocated_margin ?? 0))}`)
  if (meta.risk_based_allocated_margin !== undefined) rows.push(`风险保证金 ${formatMoney(Number(meta.risk_based_allocated_margin ?? 0))}`)
  if (hasExplicitQty) rows.push(`显式/风控数量 ${explicitQty.toFixed(6)}`)
  if (meta.risk_per_trade_pct !== undefined) rows.push(`单笔风险 ${(Number(meta.risk_per_trade_pct ?? 0) * 100).toFixed(2)}%`)
  if (meta.stop_loss_pct !== undefined) rows.push(`止损 ${(Number(meta.stop_loss_pct ?? 0) * 100).toFixed(2)}%`)
  if (meta.take_profit_pct !== undefined) rows.push(`止盈 ${(Number(meta.take_profit_pct ?? 0) * 100).toFixed(2)}%`)
  if (meta.stop_loss_price !== undefined) rows.push(`止损价 ${Number(meta.stop_loss_price ?? 0).toFixed(2)}`)
  if (meta.take_profit_price !== undefined) rows.push(`止盈价 ${Number(meta.take_profit_price ?? 0).toFixed(2)}`)
  if (meta.fee_rate !== undefined) rows.push(`手续费率 ${(Number(meta.fee_rate ?? 0) * 100).toFixed(3)}%`)
  if (meta.slippage_rate !== undefined) rows.push(`滑点率 ${(Number(meta.slippage_rate ?? 0) * 100).toFixed(3)}%`)

  return rows.length ? rows.join(' / ') : null
}

export function renderOrderMetaSummary(order: HistoryOrder) {
  const meta = parseMetaJson(order.meta_json)
  if (!meta) return order.meta_json || '-'

  const riskExecutionSummary = renderRiskExecutionSummary(meta)

  if (order.event_type === 'open') {
    return [
      `杠杆 ${meta.leverage ?? '-'}x / 保证金 ${formatMoney(Number(meta.allocated_margin ?? 0))} / 入场手续费 ${formatMoney(Number(meta.entry_fee ?? 0))} / 滑点率 ${(Number(meta.slippage_rate ?? 0) * 100).toFixed(3)}%`,
      riskExecutionSummary,
    ]
      .filter(Boolean)
      .join(' / ')
  }
  if (order.event_type === 'mark') {
    return [
      `标记价 ${meta.mark_price ?? '-'} / 预估平仓费 ${formatMoney(Number(meta.estimated_exit_fee ?? 0))} / 预估净浮盈 ${formatMoney(Number(meta.net_unrealized_pnl ?? 0))}`,
      riskExecutionSummary,
    ]
      .filter(Boolean)
      .join(' / ')
  }
  if (order.event_type === 'close') {
    return [
      `平仓价 ${meta.close_price ?? '-'} / 毛盈亏 ${formatMoney(Number(meta.gross_pnl ?? 0))} / 净盈亏 ${formatMoney(Number(meta.realized_pnl ?? 0))} / 总手续费 ${formatMoney(Number(meta.total_fees ?? 0))} / 总滑点损耗 ${formatMoney(Number(meta.total_slippage_cost ?? 0))}`,
      riskExecutionSummary,
    ]
      .filter(Boolean)
      .join(' / ')
  }
  return JSON.stringify(meta)
}

export function renderCostSummaryRows(summary: CostSummary): ReactNode {
  return (
    <>
      <div>总毛收益：{formatMoney(summary.gross_pnl)}</div>
      <div>总手续费：{formatMoney(summary.fees)}</div>
      <div>总滑点损耗：{formatMoney(summary.slippage_cost)}</div>
      <div>总净收益：{formatMoney(summary.net_pnl)}</div>
    </>
  )
}

export function calcTradeSlippageCost(trade: BacktestTrade) {
  return (Number(trade.entry_slippage ?? 0) + Number(trade.exit_slippage ?? 0)) * Number(trade.qty ?? 0)
}

export function renderTradeCostSummary(trade: BacktestTrade): ReactNode {
  return (
    <>
      <div>数量: {trade.qty} / 毛PnL: {Number(trade.gross_pnl ?? 0).toFixed(2)} / 净PnL: {Number(trade.pnl ?? 0).toFixed(2)}</div>
      <div>
        总手续费: {Number(trade.fee ?? 0).toFixed(2)} / 入场滑点: {Number(trade.entry_slippage ?? 0).toFixed(2)} / 出场滑点: {Number(trade.exit_slippage ?? 0).toFixed(2)} / 总滑点损耗: {calcTradeSlippageCost(trade).toFixed(2)}
      </div>
    </>
  )
}

export function getRunnerPayload(result: RunnerInvocationResult | RunnerExecutionResult | null | undefined) {
  return (result && 'result' in result ? result.result : result) as RunnerExecutionResult | null | undefined
}

export function getRunnerEvent(result: RunnerInvocationResult | RunnerExecutionResult | null | undefined) {
  const payload = getRunnerPayload(result)
  return payload?.event || payload?.order || null
}

export function renderRunnerEventSummary(result: RunnerInvocationResult | RunnerExecutionResult | null | undefined) {
  const event = getRunnerEvent(result)
  if (!event) return '-'
  return renderOrderMetaSummary({
    id: 0,
    position_id: event.position_id,
    symbol: event.symbol,
    side: event.side,
    price: event.price,
    qty: event.qty,
    status: event.status,
    event_type: event.event_type,
    source: event.source,
    meta_json: event.meta_json,
    created_at: '',
  })
}

export function renderRunnerExecutionSummary(result: RunnerInvocationResult | RunnerExecutionResult | null | undefined) {
  const payload = getRunnerPayload(result)
  if (!payload) return '-'

  const resultObj = payload.result && typeof payload.result === 'object' ? (payload.result as Record<string, unknown>) : null
  const risk = resultObj?.risk && typeof resultObj.risk === 'object' ? (resultObj.risk as Record<string, unknown>) : null
  const event = getRunnerEvent(result)
  const eventMeta = event?.meta_json ? parseMetaJson(event.meta_json) : null

  const parts: string[] = []
  if (payload.action) parts.push(`动作 ${String(payload.action)}`)
  if (payload.signal !== undefined && payload.signal !== null) parts.push(`信号 ${String(payload.signal)}`)
  if (payload.price !== undefined && payload.price !== null) parts.push(`价格 ${Number(payload.price).toFixed(2)}`)
  if (payload.close_reason) parts.push(`平仓原因 ${String(payload.close_reason)}`)
  if (risk?.qty !== undefined) parts.push(`风控数量 ${Number(risk.qty ?? 0).toFixed(6)}`)
  if (risk?.initial_margin !== undefined) parts.push(`初始保证金 ${formatMoney(Number(risk.initial_margin ?? 0))}`)
  if (risk?.max_loss !== undefined) parts.push(`最大亏损 ${formatMoney(Number(risk.max_loss ?? 0))}`)
  if (risk?.equity_risk_ratio !== undefined) parts.push(`风险占比 ${(Number(risk.equity_risk_ratio ?? 0) * 100).toFixed(2)}%`)

  const riskExecutionSummary = eventMeta ? renderRiskExecutionSummary(eventMeta) : null
  if (riskExecutionSummary) parts.push(riskExecutionSummary)

  return parts.length ? parts.join(' / ') : '-'
}

export function marketDataStatusColor(meta?: MarketDataMeta | null) {
  if (!meta) return '#6b7280'
  return meta.fallback_used ? '#d97706' : meta.actual_source === 'gate' ? '#16a34a' : '#2563eb'
}

export function resolveLivePositionPrice(
  position: DashboardData['positions'][number],
  marketTickers?: MarketTickers,
) {
  return marketTickers?.[position.symbol as keyof MarketTickers]?.last_price ?? position.mark_price
}

export function buildLiveAccountOverview(
  account: DashboardData['account'],
  positions: DashboardData['positions'],
  marketTickers?: MarketTickers,
): DashboardData['account'] {
  const unrealizedPnl = positions.reduce((sum, position) => {
    const livePrice = resolveLivePositionPrice(position, marketTickers)
    const nextPnl = position.side === 'long'
      ? (livePrice - position.entry_price) * position.qty
      : (position.entry_price - livePrice) * position.qty
    return sum + nextPnl
  }, 0)

  const totalNotional = positions.reduce((sum, position) => {
    const livePrice = resolveLivePositionPrice(position, marketTickers)
    return sum + livePrice * position.qty
  }, 0)

  const marginUsed = positions.reduce((sum, position) => {
    const livePrice = resolveLivePositionPrice(position, marketTickers)
    const notional = livePrice * position.qty
    return sum + (position.leverage > 0 ? notional / position.leverage : notional)
  }, 0)

  const equity = account.realized_pnl + unrealizedPnl + (account.equity - account.realized_pnl - account.unrealized_pnl)
  const availableBalance = equity - marginUsed
  const marginRatio = equity <= 0 ? 1 : marginUsed / equity
  const exposureRatio = equity <= 0 ? 1 : totalNotional / equity

  return {
    ...account,
    equity,
    available_balance: availableBalance,
    margin_used: marginUsed,
    margin_ratio: marginRatio,
    unrealized_pnl: unrealizedPnl,
    total_notional: totalNotional,
    exposure_ratio: exposureRatio,
    open_positions: positions.length,
  }
}

export function buildAccountFromLiveStatus(
  liveStatus: LiveAccountStatus,
  marketTickers?: MarketTickers,
): { account: DashboardData['account']; positions: DashboardData['positions'] } {
  const la = liveStatus.account
  if (!la) {
    return {
      account: { equity: 0, available_balance: 0, margin_used: 0, realized_pnl: 0, total_notional: 0, unrealized_pnl: 0, margin_ratio: 0, exposure_ratio: 0, open_positions: 0 },
      positions: [],
    }
  }

  const positions: DashboardData['positions'] = liveStatus.positions.map((p) => {
    const livePrice = marketTickers?.[p.symbol as keyof MarketTickers]?.last_price ?? p.mark_price
    const notional = livePrice * p.size
    const initialMargin = p.leverage > 0 ? notional / p.leverage : notional
    const pnl = p.side === 'long'
      ? (livePrice - p.entry_price) * p.size
      : (p.entry_price - livePrice) * p.size
    return {
      position_id: `${p.symbol}_${p.side}`,
      symbol: p.symbol as 'BTC_USDT' | 'ETH_USDT',
      side: p.side,
      leverage: p.leverage,
      qty: p.size,
      entry_price: p.entry_price,
      mark_price: livePrice,
      notional,
      initial_margin: initialMargin,
      margin_used: initialMargin,
      maintenance_margin: initialMargin * 0.5,
      unrealized_pnl: pnl,
      pnl_return_ratio: initialMargin > 0 ? pnl / initialMargin : 0,
      margin_ratio: la.equity > 0 ? initialMargin / la.equity : 0,
      liquidation_price: p.side === 'long' ? p.entry_price * (1 - 1 / p.leverage) : p.entry_price * (1 + 1 / p.leverage),
      liquidation_distance_ratio: 0,
    }
  })

  const totalNotional = positions.reduce((s, p) => s + p.mark_price * p.qty, 0)
  const marginRatio = la.equity > 0 ? la.margin_used / la.equity : 0
  const exposureRatio = la.equity > 0 ? totalNotional / la.equity : 0

  const account: DashboardData['account'] = {
    equity: la.equity,
    available_balance: la.available_balance,
    margin_used: la.margin_used,
    realized_pnl: 0,
    total_notional: totalNotional,
    unrealized_pnl: la.unrealized_pnl,
    margin_ratio: marginRatio,
    exposure_ratio: exposureRatio,
    open_positions: positions.length,
  }

  return { account, positions }
}

export function buildCurvePath(points: EquityPoint[], width = 520, height = 180) {
  if (!points.length) return ''
  const values = points.map((p) => p.equity)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1

  return points
    .map((p, index) => {
      const x = points.length === 1 ? width / 2 : (index / (points.length - 1)) * width
      const y = height - ((p.equity - min) / range) * height
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(' ')
}
