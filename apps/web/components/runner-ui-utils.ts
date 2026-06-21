export function canPauseRobot(params: { robotRunning?: boolean; robotEnabled?: boolean }): boolean {
  return Boolean(params.robotRunning || params.robotEnabled)
}

export type TradeDirectionMode = 'auto' | 'long_only' | 'short_only'

export function shouldStartRunnerForTradeAction(runMode: 'manual' | 'auto'): boolean {
  return runMode === 'auto'
}

export function getTradeDirectionModeOptions(): Array<{ value: TradeDirectionMode; label: string }> {
  return [
    { value: 'long_only', label: '只做多' },
    { value: 'short_only', label: '只做空' },
    { value: 'auto', label: '自动判断' },
  ]
}

type RunnerProbeLike = {
  ok?: boolean
  action?: string | null
  reason?: string | null
  error?: string | null
  result?: RunnerProbeLike | null
  results?: RunnerProbeLike[] | null
}

function compactRunnerProbeReason(payload: RunnerProbeLike): string {
  return String(payload.error || payload.reason || payload.action || 'unknown')
}

export function getRunnerStartBlockReasonAfterProbe(payload: RunnerProbeLike | null | undefined): string | null {
  if (!payload) return null

  if (Array.isArray(payload.results)) {
    for (const item of payload.results) {
      const reason = getRunnerStartBlockReasonAfterProbe(item)
      if (reason) return reason
    }
  }

  const nested = payload.result
  if (nested && (nested.ok === false || nested.error || nested.reason)) {
    return `启动前检查失败：${compactRunnerProbeReason(nested)}`
  }

  if (payload.ok === false) {
    return `启动前检查失败：${compactRunnerProbeReason(payload)}`
  }

  const action = String(payload.action || '')
  if (['rejected', 'error', 'halted'].includes(action)) {
    return `启动前检查被拒绝：${compactRunnerProbeReason(payload)}`
  }

  return null
}

type PresetConfigForRuntime = {
  symbol: 'BTC_USDT' | 'ETH_USDT'
  leverage: number
  stop_loss_pct: number
  take_profit_pct: number
  risk_per_trade_pct: number
  fee_rate: number
  slippage_rate: number
}

export function buildPresetSyncedTradeState(params: {
  currentLeverage: number
  presetConfig: PresetConfigForRuntime
}) {
  return {
    symbol: params.presetConfig.symbol,
    leverage: params.currentLeverage,
    stopLossPct: params.presetConfig.stop_loss_pct,
    takeProfitPct: params.presetConfig.take_profit_pct,
    riskPerTradePct: params.presetConfig.risk_per_trade_pct,
    feeRate: params.presetConfig.fee_rate,
    slippageRate: params.presetConfig.slippage_rate,
  }
}

export function formatSelectedPresetRuntimeSummary(params: {
  slotId: number
  name: string
  strategyTypeLabel: string
  currentLeverage: number
  stopLossPct: number
  riskPerTradePct: number
  turtleEntryPeriod?: number
  turtleExitPeriod?: number
  turtleAtrPeriod?: number
  strategyType?: 'classic' | 'turtle' | 'ict' | 'ifvg' | 'macd_trend'
}) {
  const details = params.strategyType === 'turtle'
    ? ` | Entry ${params.turtleEntryPeriod ?? '-'} | Exit ${params.turtleExitPeriod ?? '-'} | ATR ${params.turtleAtrPeriod ?? '-'}`
    : ` | stop loss ${(params.stopLossPct * 100).toFixed(2)}% | risk ${(params.riskPerTradePct * 100).toFixed(2)}%`

  return `已加载策略 ${params.slotId} | ${params.name} | ${params.strategyTypeLabel} | 实际杠杆以交易工作区选择为准 ${params.currentLeverage}x${details}`
}

export function formatStrategySlotCardSummary(params: {
  symbols: Array<'BTC_USDT' | 'ETH_USDT'>
  timeframe: '5m' | '15m' | '30m' | '1h' | '4h'
  strategyType: 'classic' | 'turtle' | 'ict' | 'ifvg' | 'macd_trend'
}) {
  const strategyTypeLabel = params.strategyType === 'turtle'
    ? '海龟'
    : params.strategyType === 'ict'
      ? 'ICT三周期'
      : params.strategyType === 'ifvg'
        ? 'IFVG'
        : params.strategyType === 'macd_trend'
          ? 'MACD趋势'
          : '经典'

  return `${params.symbols.join(' / ')} | ${params.timeframe} | ${strategyTypeLabel}`
}

const MAINTENANCE_MARGIN_RATIO = 0.005

export function getEstimatedLiquidationBufferPct(leverage: number, maintenanceMarginRatio: number = MAINTENANCE_MARGIN_RATIO): number {
  if (!Number.isFinite(leverage) || leverage <= 0) return 0
  return Math.max(0, 1 / leverage - maintenanceMarginRatio)
}

export function validateStopLossAgainstLiquidation(params: { leverage: number; stopLossPct: number }): {
  ok: boolean
  liquidationBufferPct: number
} {
  const liquidationBufferPct = getEstimatedLiquidationBufferPct(params.leverage)
  if (!Number.isFinite(params.stopLossPct) || params.stopLossPct <= 0) {
    return { ok: false, liquidationBufferPct }
  }
  return {
    ok: params.stopLossPct < liquidationBufferPct,
    liquidationBufferPct,
  }
}
