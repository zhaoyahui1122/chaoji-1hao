import type React from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'

import type { BacktestResult, BacktestRunSettings, DashboardData, DashboardRunner, HistoryOrder, HistoryPosition, RunnerInvocationResult, RunnerLogItem, StrategyConfig } from './dashboard-types'
import {
  formatMarketDataStatus,
  formatMoney,
  formatUnixTs,
  getRunnerEvent,
  getRunnerPayload,
  marketDataStatusColor,
  renderCostSummaryRows,
  renderRunnerEventSummary,
  renderRunnerExecutionSummary,
  renderTradeCostSummary,
  calcTradeSlippageCost,
  formatCloseReason,
  formatBacktestTradeTime,
  formatTradeSide,
  formatTradeStatus,
} from './dashboard-utils'
import StrategyForm from './StrategyForm'
import { formatStrategySlotCardSummary } from './runner-ui-utils'

/* ── helpers ── */

function panelHeader(title: string, hint: string, right?: React.ReactNode) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
      <div>
        <h2 className="m-0 text-2xl font-extrabold tracking-tight text-text-primary">{title}</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-text-muted">{hint}</p>
      </div>
      {right}
    </div>
  )
}

function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1.5 p-3.5 rounded-[18px] bg-gradient-to-b from-[rgba(20,24,31,0.94)] to-[rgba(14,17,22,0.96)] border border-border">
      <div className="text-xs uppercase tracking-[0.08em] text-text-muted">{label}</div>
      <div className="text-base font-extrabold text-text-primary">{value}</div>
    </div>
  )
}

function formatBacktestRange(backtest: BacktestResult): string {
  if (backtest.input.start_date && backtest.input.end_date) {
    return `${backtest.input.start_date} ~ ${backtest.input.end_date}`
  }
  return `最近 ${backtest.input.backtest_days ?? 7} 天`
}

function formatWindowLabel(start?: string | null, end?: string | null): string {
  if (!start || !end) return '-'
  return `${start.slice(0, 10)} ~ ${end.slice(0, 10)}`
}

function summarizeBacktestCloseReasons(backtest: BacktestResult | null) {
  const summary = {
    stopLoss: 0,
    takeProfit: 0,
    reverseSignal: 0,
    turtleExit: 0,
    other: 0,
  }

  for (const trade of backtest?.trades || []) {
    switch (trade.reason) {
      case 'stop_loss':
        summary.stopLoss += 1
        break
      case 'take_profit':
        summary.takeProfit += 1
        break
      case 'reverse_signal':
        summary.reverseSignal += 1
        break
      case 'turtle_exit':
        summary.turtleExit += 1
        break
      default:
        summary.other += 1
        break
    }
  }

  return summary
}

/* ── Status pill helper ── */

function StatusPill({ bg, fg, children }: { bg: string; fg: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-extrabold ${bg} ${fg}`}>
      {children}
    </span>
  )
}

/* ── Exported cards ── */

export function RunnerControlCard({
  strategy,
  dashboard,
  runnerResult,
  onSave,
  onRunBacktest,
  onInvalidateBacktest,
  onRunStrategyOnce,
  onToggleRunner,
  onResumeRunner,
  priceReference,
  strategySlotId,
  onStrategySlotChange,
  onStrategySlotNameChange,
  onAddStrategySlot,
  onDeleteStrategySlot,
  strategyPresets = [],
  backtest,
  latestRunnerLog,
  latestClosedPosition,
  recentOrders = [],
}: {
  strategy: StrategyConfig
  dashboard: DashboardData
  runnerResult: RunnerInvocationResult | null
  onSave: (config: StrategyConfig, slotId?: number, name?: string) => Promise<void>
  onRunBacktest: (config: StrategyConfig, options: BacktestRunSettings) => Promise<void>
  onInvalidateBacktest?: () => void
  onRunStrategyOnce: (symbols?: Array<'BTC_USDT' | 'ETH_USDT'>, leverage?: number, tradeMode?: 'paper' | 'live', directionMode?: 'auto' | 'long_only' | 'short_only') => Promise<unknown>
  onToggleRunner: (enabled: boolean, symbols?: Array<'BTC_USDT' | 'ETH_USDT'>, tradeMode?: 'paper' | 'live') => Promise<void>
  onResumeRunner: () => Promise<void>
  priceReference?: {
    symbol: 'BTC_USDT' | 'ETH_USDT'
    timeframe: '5m' | '15m' | '30m' | '1h' | '4h'
    live_price: number
    mark_price: number
    default_entry_price: number
    derived_stop_loss_price: number
    derived_take_profit_price: number
    stop_loss_pct: number
    take_profit_pct: number
  } | null
  strategySlotId?: number
  onStrategySlotChange?: (slotId: number) => void
  onStrategySlotNameChange?: (slotId: number, name: string) => void
  onAddStrategySlot?: (name?: string) => void
  onDeleteStrategySlot?: (slotId: number) => void
  strategyPresets?: Array<{ slotId: number; name?: string; config: StrategyConfig; locked?: boolean }>
  backtest?: BacktestResult | null
  latestRunnerLog?: RunnerLogItem | null
  latestClosedPosition?: HistoryPosition | null
  recentOrders?: HistoryOrder[]
}) {
  const runnerEvent = getRunnerEvent(runnerResult)
  const runnerPayload = getRunnerPayload(runnerResult)
  const activePreset = strategyPresets.find((item) => item.slotId === strategySlotId) || null
  const activeStrategy = activePreset?.config || strategy
  const latestRunnerPayload = getRunnerPayload(latestRunnerLog?.result)
  const latestRunnerEvent = getRunnerEvent(latestRunnerLog?.result)
  const allSupportedSymbols: Array<'BTC_USDT' | 'ETH_USDT'> = ['BTC_USDT', 'ETH_USDT']

  const runnerEnabled = dashboard.runner?.enabled ?? false
  const isLive = (dashboard.runner as any)?.trade_mode === 'live'
  const runnerPillBg = runnerEnabled ? (isLive ? 'bg-accent-amber/12' : 'bg-accent-green/12') : 'bg-slate-500/14'
  const runnerPillFg = runnerEnabled ? (isLive ? 'text-accent-amber' : 'text-accent-green') : 'text-slate-500'

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-5">
        {panelHeader(
          '策略控制',
          '参数调优、单次执行、自动 Runner 控制集中放在同一个操作面板。',
          <StatusPill bg={runnerPillBg} fg={runnerPillFg}>
            {dashboard.runner?.enabled ? `${isLive ? '实盘' : '模拟'} Runner 已启用` : 'Runner 未启用'}
          </StatusPill>,
        )}

        <div className="grid gap-4">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
            <div className="p-4 rounded-[22px] bg-gradient-to-b from-[rgba(17,20,27,0.98)] to-[rgba(11,13,18,0.98)] border border-border text-text-primary shadow-[0_22px_48px_rgba(0,0,0,0.22)]">
              <div className="text-xs uppercase tracking-[0.08em] text-text-muted">当前主策略</div>
              <div className="mt-1.5 text-xl font-black tracking-tight text-text-primary">{activePreset?.name || `策略 ${strategySlotId}`}</div>
              <div className="mt-2 text-[13px] text-slate-300">
                {activeStrategy.symbol} · {activeStrategy.timeframe} · {activeStrategy.leverage}x · {activeStrategy.strategy_type === 'turtle' ? '海龟策略' : '经典策略'}
              </div>
            </div>
            <div className="p-4 rounded-[22px] bg-gradient-to-b from-[rgba(17,20,27,0.98)] to-[rgba(11,13,18,0.98)] border border-border text-text-primary shadow-[0_22px_48px_rgba(0,0,0,0.22)]">
              <div className="text-xs uppercase tracking-[0.08em] text-text-muted">交易状态</div>
              <div className="mt-1.5 text-xl font-black tracking-tight text-text-primary">{dashboard.runner?.enabled ? (isLive ? (dashboard.runner?.is_running ? '实盘自动执行中' : '实盘已启用待执行') : (dashboard.runner?.is_running ? '模拟自动执行中' : '模拟已启用待执行')) : '未启用'}</div>
              <div className="mt-2 text-[13px] text-slate-300">下次执行：{formatUnixTs(dashboard.runner?.next_run_eta)}</div>
              <div className="mt-2 text-[13px] text-slate-300">交易对：{dashboard.runner?.selected_symbols?.join(' / ') || activeStrategy.symbol}</div>
            </div>
            <div className="p-4 rounded-[22px] bg-gradient-to-b from-[rgba(17,20,27,0.98)] to-[rgba(11,13,18,0.98)] border border-border text-text-primary shadow-[0_22px_48px_rgba(0,0,0,0.22)]">
              <div className="text-xs uppercase tracking-[0.08em] text-text-muted">最近执行判断</div>
              <div className="mt-1.5 text-xl font-black tracking-tight text-text-primary">{latestRunnerPayload?.action || latestRunnerPayload?.reason || '暂无执行'}</div>
              <div className="mt-2 text-[13px] text-slate-300">{latestRunnerPayload ? renderRunnerExecutionSummary(latestRunnerLog?.result) : '先运行一次策略或等待 Runner 产生日志。'}</div>
            </div>
            <div className="p-4 rounded-[22px] bg-gradient-to-b from-[rgba(17,20,27,0.98)] to-[rgba(11,13,18,0.98)] border border-border text-text-primary shadow-[0_22px_48px_rgba(0,0,0,0.22)]">
              <div className="text-xs uppercase tracking-[0.08em] text-text-muted">最近复盘结果</div>
              <div className="mt-1.5 text-xl font-black tracking-tight text-text-primary">{latestClosedPosition ? formatMoney(latestClosedPosition.realized_pnl) : backtest ? `${backtest.summary.return_pct}%` : '-'}</div>
              <div className="mt-2 text-[13px] text-slate-300">
                {latestClosedPosition
                  ? `${latestClosedPosition.symbol} ${formatTradeSide(latestClosedPosition.side)} · ${formatTradeStatus(latestClosedPosition.status)}`
                  : backtest
                    ? `回测交易 ${backtest.summary.trades} 笔 / 胜率 ${backtest.summary.win_rate_pct}%`
                    : '暂无最近平仓或回测结果'}
              </div>
            </div>
          </div>

          <div className="grid gap-3.5 p-[18px] rounded-[22px] bg-gradient-to-br from-[rgba(15,17,22,0.98)] via-[rgba(20,22,27,0.96)] to-[rgba(26,29,34,0.96)] border border-border">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-black text-text-primary">策略操作中枢</div>
                <div className="text-xs text-text-muted leading-relaxed">先看状态卡，再做保存、回测、Runner 操作，整个节奏更像交易终端的命令甲板。</div>
              </div>
              <span className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-extrabold bg-accent-blue/10 text-accent-blue">
                命令面板
              </span>
            </div>

            <div className="grid grid-cols-[1.2fr_0.8fr] gap-4">
              <div className="grid gap-3 p-4 rounded-[20px] bg-gradient-to-b from-[rgba(18,22,28,0.98)] to-[rgba(12,15,20,0.98)] border border-border shadow-[0_18px_40px_rgba(0,0,0,0.14)]">
                <div className="font-extrabold mb-2 text-slate-900">最近一次决策解释</div>
                <div className="grid gap-2 text-[13px] leading-[1.65]">
                  <div><strong>动作 / 信号：</strong>{latestRunnerPayload?.action || '-'} / {String(latestRunnerPayload?.signal ?? '-')}</div>
                  <div><strong>价格：</strong>{latestRunnerPayload?.price ?? '-'} / <strong>数据源：</strong><span className="font-extrabold" style={{ color: marketDataStatusColor(latestRunnerPayload?.market_data) }}>{formatMarketDataStatus(latestRunnerPayload?.market_data)}</span></div>
                  <div><strong>事件落地：</strong>{latestRunnerEvent ? renderRunnerEventSummary(latestRunnerLog?.result) : '暂无事件写入'}</div>
                  {latestRunnerPayload?.market_data?.warning ? <div className="text-accent-amber"><strong>警告：</strong>{latestRunnerPayload.market_data.warning}</div> : null}
                </div>
              </div>
              <div className="grid gap-3 p-4 rounded-[20px] bg-gradient-to-b from-[rgba(18,22,28,0.98)] to-[rgba(12,15,20,0.98)] border border-border shadow-[0_18px_40px_rgba(0,0,0,0.14)]">
                <div className="font-extrabold mb-2 text-slate-900">最近交易回放</div>
                {latestClosedPosition ? (
                  <div className="grid gap-2 text-[13px] leading-[1.65]">
                    <div><strong>{latestClosedPosition.symbol}</strong> / {formatTradeSide(latestClosedPosition.side)} / {latestClosedPosition.leverage}x</div>
                    <div>开仓：{Number(latestClosedPosition.entry_price ?? 0).toFixed(2)} → 平仓：{latestClosedPosition.close_price == null ? '-' : Number(latestClosedPosition.close_price).toFixed(2)}</div>
                    <div>净收益：{formatMoney(latestClosedPosition.realized_pnl)} / 手续费：{formatMoney(latestClosedPosition.cumulative_fees)}</div>
                    <div>滑点损耗：{formatMoney(latestClosedPosition.cumulative_slippage_cost)}</div>
                  </div>
                ) : (
                  <div className="text-[13px] text-slate-400">暂无已结束仓位，先跑一次执行或查看历史。</div>
                )}
              </div>
            </div>
          </div>

          <StrategyForm
            initial={activeStrategy}
            onSave={onSave}
            onRunBacktest={onRunBacktest}
            onInvalidateBacktest={onInvalidateBacktest}
            priceReference={priceReference}
            strategySlotId={strategySlotId}
            strategySlotName={activePreset?.name || ''}
            strategySlots={strategyPresets.map((item) => ({
              slotId: item.slotId,
              name: item.name,
              config: {
                symbol: item.config.symbol,
                symbols: item.config.symbols,
                timeframe: item.config.timeframe,
                strategy_type: item.config.strategy_type,
                leverage: item.config.leverage,
                stop_loss_pct: item.config.stop_loss_pct,
                take_profit_pct: item.config.take_profit_pct,
                risk_per_trade_pct: item.config.risk_per_trade_pct,
                turtle_entry_period: item.config.turtle_entry_period,
                turtle_exit_period: item.config.turtle_exit_period,
                turtle_atr_period: item.config.turtle_atr_period,
                turtle_atr_filter: item.config.turtle_atr_filter,
                turtle_adx_period: item.config.turtle_adx_period,
                turtle_adx_threshold: item.config.turtle_adx_threshold,
                turtle_force_mode: item.config.turtle_force_mode,
                fee_rate: item.config.fee_rate,
                slippage_rate: item.config.slippage_rate,
                classic_trend_filter_enabled: item.config.classic_trend_filter_enabled,
                classic_cooldown_bars: item.config.classic_cooldown_bars,
              },
              locked: item.locked ?? false,
            }))}
            onStrategySlotChange={onStrategySlotChange}
            onStrategySlotNameChange={onStrategySlotNameChange}
            onAddStrategySlot={onAddStrategySlot}
            onDeleteStrategySlot={onDeleteStrategySlot}
          />

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button size="lg" className="font-extrabold shadow-[0_10px_22px_rgba(0,0,0,0.22)]" onClick={() => onRunStrategyOnce()}>运行一次策略执行</Button>
            <Button
              size="lg"
              variant={dashboard.runner?.enabled ? 'destructive' : 'default'}
              className="font-extrabold"
              onClick={() => {
                const enabling = !(dashboard.runner?.enabled ?? false)
                onToggleRunner(
                  enabling,
                  enabling ? (activeStrategy.symbols && activeStrategy.symbols.length > 0 ? activeStrategy.symbols : [activeStrategy.symbol]) : undefined,
                  enabling ? undefined : (dashboard.runner as any)?.trade_mode,
                )
              }}
            >
              {dashboard.runner?.enabled ? '暂停机器人并市价平仓' : '开启自动运行标记'}
            </Button>
            {dashboard.runner?.manual_resume_required ? (
              <Button size="lg" className="font-extrabold bg-amber-600 text-white hover:bg-amber-700" onClick={onResumeRunner}>手动恢复 Runner</Button>
            ) : null}
          </div>

          {runnerResult ? (
            <div className="mt-4 p-3.5 rounded-[18px] bg-gradient-to-b from-[rgba(18,22,29,0.96)] to-[rgba(12,15,20,0.98)] border border-border text-text-secondary grid gap-2 text-[13px] leading-[1.6]">
              <div className="flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-violet-500/12 text-violet-600">
                  {activeStrategy.strategy_type === 'turtle' ? '当前执行：海龟策略' : activeStrategy.strategy_type === 'ict' ? '当前执行：ICT三周期策略' : '当前执行：经典策略'}
                </span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-teal-500/12 text-teal-700">
                  {activeStrategy.symbol} · {activeStrategy.timeframe} · {activeStrategy.leverage}x
                </span>
                {activeStrategy.strategy_type === 'turtle' ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-violet-700/12 text-violet-800">
                    Entry {activeStrategy.turtle_entry_period} / Exit {activeStrategy.turtle_exit_period} / ATR {activeStrategy.turtle_atr_period}
                  </span>
                ) : activeStrategy.strategy_type === 'ict' ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-700/10 text-emerald-800">
                    BOS {activeStrategy.ict_bos_lookback ?? 20} / RR 1:{activeStrategy.ict_risk_reward ?? 2.5}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-600/14 text-amber-700">
                    {[
                      activeStrategy.use_boll ? `BOLL ${activeStrategy.boll_period}/${activeStrategy.boll_std}` : null,
                      activeStrategy.use_rsi ? `RSI ${activeStrategy.rsi_period}` : null,
                      activeStrategy.use_ma ? `MA ${activeStrategy.ma_short}/${activeStrategy.ma_long}` : null,
                    ].filter(Boolean).join(' ｜ ') || '未启用经典指标条件'}
                  </span>
                )}
              </div>
              <div><strong>执行动作：</strong>{runnerPayload?.action || '-'} / 信号：{String(runnerPayload?.signal)} / 价格：{runnerPayload?.price ?? '-'}</div>
              {runnerEvent ? (
                <>
                  <div><strong>本次事件：</strong>{runnerEvent.event_type || '-'} / 来源：{runnerEvent.source || '-'}</div>
                  <div><strong>仓位 ID：</strong>{runnerEvent.position_id || '-'}</div>
                  <div><strong>事件详情：</strong>{renderRunnerEventSummary(runnerResult)}</div>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

export function RunnerStatusCard({ runner }: { runner?: DashboardRunner }) {
  const lastRunnerResult = runner?.last_result
  const lastRunnerEvent = getRunnerEvent(lastRunnerResult)
  const lastRunnerPayload = getRunnerPayload(lastRunnerResult)
  const tradeMode = runner?.trade_mode || 'paper'
  const modeLabel = tradeMode === 'live' ? '实盘' : '模拟'

  const statusPillBg = runner?.is_running ? (tradeMode === 'live' ? 'bg-accent-amber/14' : 'bg-accent-green/14') : 'bg-slate-500/14'
  const statusPillFg = runner?.is_running ? (tradeMode === 'live' ? 'text-accent-amber' : 'text-accent-green') : 'text-slate-500'

  return (
    <Card>
      <CardContent className="p-5">
        {panelHeader(
          'Runner 状态',
          '自动执行、调度与最近一次事件回执。',
          <StatusPill bg={statusPillBg} fg={statusPillFg}>
            {runner?.is_running ? `${modeLabel}运行中` : runner?.enabled ? `${modeLabel}已启用` : '空闲'}
          </StatusPill>,
        )}

        <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
          <StatBlock label="启用标记" value={runner?.enabled ? '是' : '否'} />
          <StatBlock label="交易对组合" value={runner?.selected_symbols?.join(' / ') || '-'} />
          <StatBlock label="累计执行" value={String(runner?.loop_count ?? 0)} />
          <StatBlock label="最近执行" value={runner?.last_run_at || '-'} />
          <StatBlock label="下次执行" value={formatUnixTs(runner?.next_run_eta)} />
          <StatBlock label="最近执行 K 线" value={formatUnixTs(runner?.last_executed_candle_eta)} />
          <StatBlock label="需要手动恢复" value={runner?.manual_resume_required ? '是' : '否'} />
        </div>

        <div className="mt-3.5 grid gap-2.5 text-sm">
          <div>
            市场数据源：
            <span className="font-extrabold" style={{ color: marketDataStatusColor(lastRunnerPayload?.market_data) }}>
              {formatMarketDataStatus(lastRunnerPayload?.market_data)}
            </span>
          </div>
          {lastRunnerPayload?.market_data?.warning ? <div className="text-accent-amber">数据警告：{lastRunnerPayload.market_data.warning}</div> : null}
          <StatusPill bg={runner?.guard?.allowed ? 'bg-accent-green/12' : 'bg-accent-red/12'} fg={runner?.guard?.allowed ? 'text-accent-green' : 'text-accent-red'}>
            熔断状态：{runner?.guard?.allowed ? '正常' : `停止 (${runner?.guard?.halt_reason})`}
          </StatusPill>
          {runner?.last_error ? <div className="text-accent-red">最近错误：{runner.last_error}</div> : null}
          {lastRunnerPayload ? (
            <div className="p-3.5 rounded-[18px] bg-gradient-to-b from-[rgba(18,22,29,0.96)] to-[rgba(12,15,20,0.98)] border border-border text-text-secondary">
              最近执行摘要：{renderRunnerExecutionSummary(lastRunnerResult)}
            </div>
          ) : null}
          {lastRunnerEvent ? (
            <div className="p-3.5 rounded-[18px] bg-gradient-to-b from-[rgba(18,22,29,0.96)] to-[rgba(12,15,20,0.98)] border border-border text-text-secondary">
              <div className="font-extrabold mb-1.5">最近写入事件</div>
              <div>事件类型：{lastRunnerEvent.event_type || '-'}</div>
              <div>来源：{lastRunnerEvent.source || '-'}</div>
              <div>仓位ID：{lastRunnerEvent.position_id || '-'}</div>
              <div>事件详情：{renderRunnerEventSummary(lastRunnerResult)}</div>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

export function RunnerGuardCard({ runner }: { runner?: DashboardRunner }) {
  const danger = Number(runner?.guard?.daily_loss_ratio ?? 0) > 0.05 || Number(runner?.guard?.exposure_ratio ?? 0) > 2

  return (
    <Card>
      <CardContent className="p-5">
        {panelHeader(
          '高级风控',
          '连续亏损、日内损益与敞口约束。',
          <StatusPill bg={danger ? 'bg-accent-red/12' : 'bg-accent-green/12'} fg={danger ? 'text-accent-red' : 'text-accent-green'}>
            {danger ? '注意风险' : '风险可控'}
          </StatusPill>,
        )}

        <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
          <StatBlock label="连续亏损次数" value={String(runner?.guard?.consecutive_loss_count ?? 0)} />
          <StatBlock label="24h 已实现盈亏" value={formatMoney(runner?.guard?.daily_realized_pnl)} />
          <StatBlock label="24h 亏损占比" value={`${(Number(runner?.guard?.daily_loss_ratio ?? 0) * 100).toFixed(2)}%`} />
          <StatBlock label="当前总名义敞口" value={formatMoney(runner?.guard?.total_notional)} />
          <StatBlock label="总敞口 / 权益" value={`${(Number(runner?.guard?.exposure_ratio ?? 0) * 100).toFixed(2)}%`} />
        </div>
      </CardContent>
    </Card>
  )
}

export function SupportScopeCard({ dashboard }: { dashboard: DashboardData }) {
  return (
    <Card>
      <CardContent className="p-5">
        {panelHeader('支持范围', '明确当前策略工作台支持的交易对、周期与杠杆边界。')}
        <div className="grid gap-3">
          <div className="p-3.5 rounded-[18px] bg-gradient-to-b from-[rgba(18,22,29,0.96)] to-[rgba(12,15,20,0.98)] border border-border text-text-secondary">
            <div className="flex flex-wrap gap-2">
              {dashboard.supported_symbols.map((symbol) => (
                <Badge key={symbol} variant="secondary" className="bg-accent-blue/12 text-accent-blue">{symbol}</Badge>
              ))}
            </div>
          </div>
          <div className="p-3.5 rounded-[18px] bg-gradient-to-b from-[rgba(18,22,29,0.96)] to-[rgba(12,15,20,0.98)] border border-border text-text-secondary">
            <div className="flex flex-wrap gap-2">
              {dashboard.supported_timeframes.map((timeframe) => (
                <Badge key={timeframe} variant="secondary" className="bg-violet-500/12 text-violet-500">{timeframe}</Badge>
              ))}
            </div>
          </div>
          <div className="p-3.5 rounded-[18px] bg-gradient-to-b from-[rgba(18,22,29,0.96)] to-[rgba(12,15,20,0.98)] border border-border text-text-secondary">杠杆范围：1 - 100</div>
        </div>
      </CardContent>
    </Card>
  )
}

export function BacktestSummaryCard({ backtest }: { backtest: BacktestResult | null }) {
  const closeReasonSummary = summarizeBacktestCloseReasons(backtest)

  return (
    <Card>
      <CardContent className="p-5">
        {panelHeader(
          '回测结果',
          '收益、回撤、数据源、风险校验与选定周期表现。',
          backtest ? (
            <StatusPill bg={backtest.risk.allowed ? 'bg-accent-green/12' : 'bg-accent-red/12'} fg={backtest.risk.allowed ? 'text-accent-green' : 'text-accent-red'}>
              {backtest.risk.allowed ? '风险通过' : '风险拒绝'}
            </StatusPill>
          ) : null,
        )}
        {!backtest ? (
          <p className="text-text-muted">点击"运行回测"后展示结果</p>
        ) : (
          <>
            <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)] gap-3.5 p-[18px] rounded-3xl bg-gradient-to-br from-[rgba(12,14,18,0.98)] via-[rgba(20,23,29,0.96)] to-[rgba(28,31,36,0.96)] border border-border text-slate-300">
              <div className="grid gap-2.5">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary" className="bg-white/12 text-white">
                    {backtest.input.strategy_type === 'turtle' ? '海龟策略' : '经典策略'}
                  </Badge>
                  <Badge variant="secondary" className="bg-teal-400/12 text-teal-100">
                    {backtest.input.symbol || '-'} · {backtest.input.timeframe || '-'}
                  </Badge>
                  <Badge variant="secondary" className="bg-accent-blue/14 text-blue-100">
                    {formatBacktestRange(backtest)}
                  </Badge>
                </div>
                <div className="text-[28px] font-black tracking-[-0.04em] text-white">
                  {formatMoney(backtest.summary.net_pnl ?? backtest.summary.total_net_pnl)}
                </div>
                <div className="text-sm leading-[1.7] text-slate-300/86">
                  {backtest.input.strategy_type === 'turtle'
                    ? `海龟参数：Entry ${backtest.input.turtle_entry_period ?? '-'} / Exit ${backtest.input.turtle_exit_period ?? '-'} / ATR ${backtest.input.turtle_atr_period ?? '-'}`
                    : [
                      backtest.input.use_boll ? `BOLL ${backtest.input.boll_period ?? '-'} / ${backtest.input.boll_std ?? '-'}` : null,
                      backtest.input.use_rsi ? `RSI ${backtest.input.rsi_period ?? '-'}` : null,
                      backtest.input.use_ma ? `MA ${backtest.input.ma_short ?? '-'} / ${backtest.input.ma_long ?? '-'}` : null,
                    ].filter(Boolean).join(' ｜ ') || '未启用经典指标条件'}
                </div>
              </div>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-2.5">
                <div className="px-3.5 py-3 rounded-[18px] bg-[rgba(10,12,16,0.42)] border border-border">
                  <div className="text-xs uppercase tracking-[0.08em] text-text-muted font-extrabold">收益率</div>
                  <div className="mt-1.5 text-xl font-black tracking-tight text-white">{backtest.summary.return_pct}%</div>
                </div>
                <div className="px-3.5 py-3 rounded-[18px] bg-[rgba(10,12,16,0.42)] border border-border">
                  <div className="text-xs uppercase tracking-[0.08em] text-text-muted font-extrabold">最大回撤</div>
                  <div className="mt-1.5 text-xl font-black tracking-tight text-white">{backtest.summary.max_drawdown_pct}%</div>
                </div>
                <div className="px-3.5 py-3 rounded-[18px] bg-[rgba(10,12,16,0.42)] border border-border">
                  <div className="text-xs uppercase tracking-[0.08em] text-text-muted font-extrabold">交易次数</div>
                  <div className="mt-1.5 text-xl font-black tracking-tight text-white">{backtest.summary.trades}</div>
                </div>
                <div className="px-3.5 py-3 rounded-[18px] bg-[rgba(10,12,16,0.42)] border border-border">
                  <div className="text-xs uppercase tracking-[0.08em] text-text-muted font-extrabold">实际K线</div>
                  <div className="mt-1.5 text-xl font-black tracking-tight text-white">{backtest.market_data?.candles ?? '-'}</div>
                </div>
              </div>
            </div>
            <div className="mt-3.5 grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
              <StatBlock label="回测周期" value={formatBacktestRange(backtest)} />
              <StatBlock label="实际区间" value={formatWindowLabel(backtest.market_data?.actual_window_start, backtest.market_data?.actual_window_end)} />
              <StatBlock label="实际K线" value={String(backtest.market_data?.candles ?? '-')} />
              <StatBlock label="收益率" value={`${backtest.summary.return_pct}%`} />
              <StatBlock label="最大回撤" value={`${backtest.summary.max_drawdown_pct}%`} />
              <StatBlock label="交易次数" value={String(backtest.summary.trades)} />
              <StatBlock label="盈利" value={formatMoney(backtest.summary.net_pnl ?? backtest.summary.total_net_pnl)} />
              <StatBlock label="止盈次数" value={String(closeReasonSummary.takeProfit)} />
              <StatBlock label="止损次数" value={String(closeReasonSummary.stopLoss)} />
              <StatBlock label="反转平仓" value={String(closeReasonSummary.reverseSignal)} />
              <StatBlock label="海龟出场" value={String(closeReasonSummary.turtleExit)} />
              <StatBlock label="????" value={String(backtest.assumptions?.stop_take_profit_trigger ?? 'high_low_intrabar')} />
              <StatBlock label="????" value={(backtest.assumptions?.liquidation_check as any)?.ok === false ? '????????' : '???'} />
            </div>
            <div className="mt-3.5 grid grid-cols-[minmax(0,1fr)_minmax(280px,0.9fr)] gap-3.5">
              <div className="grid gap-3 p-4 rounded-[20px] bg-gradient-to-b from-[rgba(18,22,28,0.98)] to-[rgba(12,15,20,0.98)] border border-border shadow-[0_18px_40px_rgba(0,0,0,0.14)]">
                <div className="text-sm font-black text-text-primary">数据窗口与来源</div>
                <div className="grid gap-2 text-sm">
                  <div>请求数据源：{backtest.input.data_source}</div>
                  <div>
                实际数据源：
                <span className="font-extrabold" style={{ color: marketDataStatusColor(backtest.market_data) }}>
                  {formatMarketDataStatus(backtest.market_data)}
                </span>
                  </div>
                  <div>请求区间：{formatWindowLabel(backtest.market_data?.requested_window_start, backtest.market_data?.requested_window_end)}</div>
                  <div>???????? {String(backtest.assumptions?.fee_rate ?? backtest.input.fee_rate ?? '-')}??? {String(backtest.assumptions?.slippage_rate ?? backtest.input.slippage_rate ?? '-')}??? {String(backtest.assumptions?.leverage ?? backtest.input.leverage ?? '-')}x</div>
                  <div>?????{String(backtest.assumptions?.contract_unit ?? '???????????? Gate ???? quanto_multiplier ??')}</div>
                  {backtest.market_data?.warning ? <div className="text-accent-amber">数据警告：{backtest.market_data.warning}</div> : null}
                  {closeReasonSummary.other > 0 ? <div>其他平仓原因：{closeReasonSummary.other} 次</div> : null}
                </div>
              </div>
              <div className="grid gap-3 p-4 rounded-[20px] bg-gradient-to-b from-[rgba(18,22,28,0.98)] to-[rgba(12,15,20,0.98)] border border-border shadow-[0_18px_40px_rgba(0,0,0,0.14)]">
                <div className="text-sm font-black text-text-primary">成本拆解与结束权益</div>
                <div className="p-3.5 rounded-[18px] bg-gradient-to-b from-[rgba(18,22,29,0.96)] to-[rgba(12,15,20,0.98)] border border-border text-text-secondary">{renderCostSummaryRows(backtest.summary)}</div>
                <div className="text-sm text-slate-700">结束权益：{formatMoney(backtest.summary.ending_equity)}</div>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

export function BacktestRiskCard({ backtest }: { backtest: BacktestResult | null }) {
  return (
    <Card>
      <CardContent className="p-5">
        {panelHeader('风险提示', '聚焦回测风控口径：杠杆、保证金、最大亏损、风险占比。')}
        {!backtest ? (
          <p className="text-text-muted">运行回测后显示风险结果</p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
            <StatBlock label="杠杆" value={`${backtest.risk.leverage}x`} />
            <StatBlock label="初始保证金" value={formatMoney(backtest.risk.initial_margin)} />
            <StatBlock label="最大亏损" value={formatMoney(backtest.risk.max_loss)} />
            <StatBlock label="风险占权益比" value={`${(Number(backtest.risk.equity_risk_ratio) * 100).toFixed(2)}%`} />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function BacktestTradesCard({ backtest }: { backtest: BacktestResult | null }) {
  return (
    <Card>
      <CardContent className="p-5">
        {panelHeader('回测交易列表', '按交易条目复盘开平仓价格、原因与成本结构。')}
        {!backtest || !backtest.trades || backtest.trades.length === 0 ? (
          <p className="text-text-muted">暂无交易记录</p>
        ) : (
          <ScrollArea className="max-h-[320px]">
            <div className="grid gap-2.5">
              {backtest.trades.map((trade, idx) => (
                <div key={idx} className="rounded-[18px] border border-border bg-gradient-to-b from-[rgba(18,22,29,0.96)] to-[rgba(12,15,20,0.98)] p-3.5 grid gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-[15px] text-slate-900">{backtest.input.symbol || '-'}</strong>
                      <Badge variant="secondary" className={trade.side === 'long' ? 'bg-accent-blue/12 text-accent-blue' : 'bg-violet-500/12 text-violet-500'}>{formatTradeSide(trade.side)}</Badge>
                      <Badge variant="secondary" className="bg-slate-400/18 text-slate-700">{formatTradeStatus(trade.status || 'closed')}</Badge>
                      <Badge variant="secondary" className="bg-slate-900/8 text-slate-900">{trade.leverage ?? backtest.input.leverage ?? 1}x</Badge>
                    </div>
                    <div className="font-extrabold" style={{ color: Number(trade.pnl ?? 0) >= 0 ? '#166534' : '#b91c1c' }}>{formatMoney(trade.pnl)}</div>
                  </div>
                  <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-2.5 mt-1">
                    <div className="px-3 py-2.5 rounded-[14px] bg-accent-blue/6 border border-accent-blue/14">
                      <div className="text-[11px] uppercase tracking-[0.08em] text-text-muted">交易时间窗</div>
                      <div className="mt-1.5 text-[13px] text-slate-900 leading-[1.7]">
                        {formatBacktestTradeTime(trade.entry_time)} → {formatBacktestTradeTime(trade.exit_time)}
                      </div>
                    </div>
                    <div className="px-3 py-2.5 rounded-[14px] bg-accent-green/6 border border-accent-green/14">
                      <div className="text-[11px] uppercase tracking-[0.08em] text-text-muted">交易备注</div>
                      <div className="mt-1.5 text-[13px] text-slate-900 leading-[1.7]">
                        {formatTradeSide(trade.side)} / {formatTradeStatus(trade.status || 'closed')} / {formatCloseReason(trade.reason)}
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-2.5 mt-3">
                    <StatBlock label="开仓价" value={Number(trade.entry_price ?? 0).toFixed(2)} />
                    <StatBlock label="平仓价" value={Number(trade.exit_price ?? 0).toFixed(2)} />
                    <StatBlock label="数量" value={Number(trade.qty ?? 0).toFixed(6)} />
                    <StatBlock label="手续费" value={formatMoney(trade.cumulative_fees ?? trade.fee)} />
                    <StatBlock label="滑点损耗" value={formatMoney(trade.cumulative_slippage_cost ?? calcTradeSlippageCost(trade))} />
                    <StatBlock label="平仓原因" value={formatCloseReason(trade.reason)} />
                  </div>
                  <div className="mt-3 p-3 rounded-[14px] bg-slate-100/[0.78] text-slate-700 text-[13px] leading-[1.6]">
                    <div><strong>开仓时间：</strong>{formatBacktestTradeTime(trade.entry_time)}</div>
                    <div className="mt-1.5"><strong>平仓时间：</strong>{formatBacktestTradeTime(trade.exit_time)}</div>
                    <div className="mt-1.5"><strong>持仓复盘：</strong>{backtest.input.symbol || '-'} {formatTradeSide(trade.side)} {trade.leverage ?? backtest.input.leverage ?? 1}x 从 {Number(trade.entry_price ?? 0).toFixed(2)} 开仓，在 {Number(trade.exit_price ?? 0).toFixed(2)} 以"{formatCloseReason(trade.reason)}"平仓，净收益 {formatMoney(trade.pnl)}。</div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  )
}
