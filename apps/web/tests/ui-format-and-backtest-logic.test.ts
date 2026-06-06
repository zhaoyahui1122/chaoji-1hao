import assert from 'node:assert/strict'

import {
  deriveTradingWorkspaceSnapshot,
  formatBacktestTradeTime,
  formatTradeStatus,
} from '../components/dashboard-utils'
import { getBacktestDraft, resolveBacktestRunSelection, setBacktestDraft } from '../components/backtest-date-utils'
import {
  buildPresetSyncedTradeState,
  canPauseRobot,
  formatSelectedPresetRuntimeSummary,
  formatStrategySlotCardSummary,
  getEstimatedLiquidationBufferPct,
  getRunnerStartBlockReasonAfterProbe,
  getTradeDirectionModeOptions,
  shouldStartRunnerForTradeAction,
  validateStopLossAgainstLiquidation,
} from '../components/runner-ui-utils'

function testFormatBacktestTradeTime() {
  const formatted = formatBacktestTradeTime('1780022700.0')
  assert.notEqual(formatted, '1780022700.0', 'timestamp should be formatted')
  assert.match(formatted, /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/)
}

function testFormatTradeStatus() {
  assert.notEqual(formatTradeStatus('closed'), 'closed')
  assert.notEqual(formatTradeStatus('open'), 'open')
}

function testResolveBacktestRunSelection() {
  const result = resolveBacktestRunSelection({
    backtestDays: 7,
    backtestStartDate: '2026-05-01',
    backtestEndDate: '2026-05-05',
  })

  assert.equal(result.successLabel, '2026-05-01 ~ 2026-05-05')
  assert.deepEqual(result.options, {
    backtest_days: 5,
    start_date: '2026-05-01',
    end_date: '2026-05-05',
  })
}

function testCanPauseRobotWhenRunnerEnabledButIdle() {
  assert.equal(
    canPauseRobot({ robotRunning: false, robotEnabled: true }),
    true,
    'runner should still be pausable when enabled but idle',
  )
  assert.equal(canPauseRobot({ robotRunning: false, robotEnabled: false }), false)
}

function testBacktestDraftStoreKeepsLatestSlotDraft() {
  const fallback = {
    backtestDays: 7,
    backtestStartDate: '',
    backtestEndDate: '',
    backtestSymbol: 'BTC_USDT' as const,
    backtestLeverage: 50,
  }

  assert.deepEqual(getBacktestDraft(1, fallback), fallback)

  setBacktestDraft(1, {
    backtestDays: 5,
    backtestStartDate: '2026-05-25',
    backtestEndDate: '2026-05-29',
    backtestSymbol: 'ETH_USDT',
    backtestLeverage: 25,
  })

  assert.deepEqual(getBacktestDraft(1, fallback), {
    backtestDays: 5,
    backtestStartDate: '2026-05-25',
    backtestEndDate: '2026-05-29',
    backtestSymbol: 'ETH_USDT',
    backtestLeverage: 25,
  })
}

function testManualTradeActionDoesNotStartRunner() {
  assert.equal(shouldStartRunnerForTradeAction('manual'), false)
  assert.equal(shouldStartRunnerForTradeAction('auto'), true)
}

function testTradeDirectionModeOptions() {
  const options = getTradeDirectionModeOptions()
  assert.equal(options.length, 3)
  assert.deepEqual(options.map((item) => item.value), ['long_only', 'short_only', 'auto'])
}

function testStopLossValidationAgainstLiquidation() {
  assert.equal(getEstimatedLiquidationBufferPct(100), 0.005)
  assert.equal(validateStopLossAgainstLiquidation({ leverage: 100, stopLossPct: 0.02 }).ok, false)
  assert.equal(validateStopLossAgainstLiquidation({ leverage: 20, stopLossPct: 0.02 }).ok, true)
}

function testPresetSyncKeepsCurrentLeverage() {
  const nextState = buildPresetSyncedTradeState({
    currentLeverage: 50,
    presetConfig: {
      symbol: 'BTC_USDT',
      leverage: 5,
      stop_loss_pct: 0.02,
      take_profit_pct: 0.04,
      risk_per_trade_pct: 0.01,
      fee_rate: 0.0005,
      slippage_rate: 0.0002,
    },
  })

  assert.equal(nextState.symbol, 'BTC_USDT')
  assert.equal(nextState.leverage, 50, 'should preserve current runtime leverage')
}

function testPresetSummaryUsesCurrentRuntimeLeverage() {
  const summary = formatSelectedPresetRuntimeSummary({
    slotId: 2,
    name: 'trend',
    strategyTypeLabel: 'classic',
    currentLeverage: 50,
    stopLossPct: 0.02,
    riskPerTradePct: 0.01,
  })

  assert.equal(summary.includes('50x'), true)
  assert.equal(summary.includes('50x'), true)
}

function testRunnerStartProbeBlocksRejectedOrFailedFirstRun() {
  assert.equal(
    getRunnerStartBlockReasonAfterProbe({ ok: true, action: 'idle' }),
    null,
    'idle first probe should allow starting the scheduled runner',
  )
  assert.match(
    getRunnerStartBlockReasonAfterProbe({ ok: true, action: 'rejected', result: { ok: false, reason: 'stop_loss_after_liquidation' } }) || '',
    /rejected|stop_loss_after_liquidation/,
  )
  assert.match(
    getRunnerStartBlockReasonAfterProbe({ ok: false, action: 'error', reason: 'no_market_data' }) || '',
    /error|no_market_data/,
  )
  assert.match(
    getRunnerStartBlockReasonAfterProbe({
      ok: true,
      action: 'multi_symbol_cycle',
      results: [
        { ok: true, action: 'idle' },
        { ok: true, action: 'rejected', result: { ok: false, error: 'stop_loss_order_failed' } },
      ],
    }) || '',
    /stop_loss_order_failed|rejected/,
  )
}

function testStrategySlotSummaryDoesNotExposeStrategyLeverage() {
  const summary = formatStrategySlotCardSummary({
    symbols: ['BTC_USDT', 'ETH_USDT'],
    timeframe: '15m',
    strategyType: 'classic',
  })

  assert.equal(summary.includes('BTC_USDT / ETH_USDT'), true)
  assert.equal(summary.includes('15m'), true)
  assert.equal(summary.includes('x'), false)
}

function testLiveModeUsesLiveAccountStatusForOverview() {
  const dashboard = {
    account: {
      equity: 10000,
      available_balance: 10000,
      margin_used: 0,
      realized_pnl: 0,
      total_notional: 0,
      unrealized_pnl: 0,
      margin_ratio: 0,
      exposure_ratio: 0,
      open_positions: 0,
    },
    positions: [],
  }

  const liveStatus = {
    connected: true,
    has_credentials: true,
    last_sync_at: '2026-06-06T00:00:00Z',
    last_error: null,
    account: {
      equity: 666,
      available_balance: 555,
      margin_used: 111,
      unrealized_pnl: 12,
    },
    positions: [{
      symbol: 'BTC_USDT',
      side: 'long' as const,
      leverage: 50,
      size: 0.01,
      entry_price: 100000,
      mark_price: 101000,
      unrealized_pnl: 10,
    }],
    source: 'gate_futures_live',
  }

  const liveView = deriveTradingWorkspaceSnapshot({
    dashboard,
    tradeMode: 'live',
    liveStatus,
  })
  assert.equal(liveView.account.equity, 666, 'live mode should display Gate live equity')
  assert.equal(liveView.positions.length, 1, 'live mode should display Gate live positions')

  const paperView = deriveTradingWorkspaceSnapshot({
    dashboard,
    tradeMode: 'paper',
    liveStatus,
  })
  assert.equal(paperView.account.equity, 10000, 'paper mode should keep simulated equity')
  assert.equal(paperView.positions.length, 0)
}

testFormatBacktestTradeTime()
testFormatTradeStatus()
testResolveBacktestRunSelection()
testCanPauseRobotWhenRunnerEnabledButIdle()
testBacktestDraftStoreKeepsLatestSlotDraft()
testManualTradeActionDoesNotStartRunner()
testTradeDirectionModeOptions()
testStopLossValidationAgainstLiquidation()
testPresetSyncKeepsCurrentLeverage()
testPresetSummaryUsesCurrentRuntimeLeverage()
testRunnerStartProbeBlocksRejectedOrFailedFirstRun()
testStrategySlotSummaryDoesNotExposeStrategyLeverage()
testLiveModeUsesLiveAccountStatusForOverview()

console.log('ui-format-and-backtest-logic tests passed')
