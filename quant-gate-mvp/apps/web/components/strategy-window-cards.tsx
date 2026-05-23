import type React from 'react'

import type { BacktestResult, DashboardData, DashboardRunner, HistoryOrder, HistoryPosition, RunnerInvocationResult, RunnerLogItem, StrategyConfig } from './dashboard-types'
import { cardStyle, chipStyle, sectionHintStyle, sectionTitleStyle } from './dashboard-types'
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
} from './dashboard-utils'
import StrategyForm from './StrategyForm'

const pillBase: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 800,
}

const statGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
  gap: 12,
}

const statBlock: React.CSSProperties = {
  display: 'grid',
  gap: 6,
  padding: 14,
  borderRadius: 18,
  background: 'rgba(248,250,252,0.9)',
  border: '1px solid rgba(148,163,184,0.16)',
}

const statLabel: React.CSSProperties = {
  fontSize: 12,
  color: '#64748b',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
}

const statValue: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 800,
  color: '#0f172a',
}

const summaryPanel: React.CSSProperties = {
  padding: 14,
  borderRadius: 18,
  background: 'rgba(241,245,249,0.95)',
  border: '1px solid rgba(148,163,184,0.18)',
  color: '#334155',
}

const timelineList: React.CSSProperties = {
  display: 'grid',
  gap: 10,
  maxHeight: 320,
  overflow: 'auto',
}

const timelineCard: React.CSSProperties = {
  borderRadius: 18,
  border: '1px solid rgba(148,163,184,0.16)',
  background: 'rgba(248,250,252,0.9)',
  padding: 14,
  display: 'grid',
  gap: 8,
}

const primaryButtonStyle: React.CSSProperties = {
  padding: '12px 16px',
  borderRadius: 12,
  border: 0,
  background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
  color: '#fff',
  fontWeight: 800,
}

const secondaryButtonStyle: React.CSSProperties = {
  padding: '12px 16px',
  borderRadius: 12,
  border: 0,
  fontWeight: 800,
}

function panelHeader(title: string, hint: string, right?: React.ReactNode) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
      <div>
        <h2 style={sectionTitleStyle}>{title}</h2>
        <p style={sectionHintStyle}>{hint}</p>
      </div>
      {right}
    </div>
  )
}

function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <div style={statBlock}>
      <div style={statLabel}>{label}</div>
      <div style={statValue}>{value}</div>
    </div>
  )
}

export function RunnerControlCard({
  strategy,
  dashboard,
  runnerResult,
  onSave,
  onRunBacktest,
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
  onRunBacktest: (config: StrategyConfig) => Promise<void>
  onRunStrategyOnce: () => Promise<void>
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

  return (
    <div style={{ ...cardStyle, overflow: 'hidden' }}>
      {panelHeader(
        '策略控制',
        '参数调优、单次执行、自动 Runner 控制集中放在同一个操作面板。',
        <div style={{ ...pillBase, background: dashboard.runner?.enabled ? ((dashboard.runner as any)?.trade_mode === 'live' ? 'rgba(245,158,11,0.12)' : 'rgba(34,197,94,0.12)') : 'rgba(148,163,184,0.14)', color: dashboard.runner?.enabled ? ((dashboard.runner as any)?.trade_mode === 'live' ? '#b45309' : '#15803d') : '#475569' }}>
          {dashboard.runner?.enabled ? `${(dashboard.runner as any)?.trade_mode === 'live' ? '实盘' : '模拟'} Runner 已启用` : 'Runner 未启用'}
        </div>,
      )}

      <div style={{ display: 'grid', gap: 16 }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 12,
          marginBottom: 16,
        }}>
          <div style={summaryPanel}>
            <div style={statLabel}>当前主策略</div>
            <div style={{ ...statValue, marginTop: 6 }}>{activePreset?.name || `策略 ${strategySlotId}`}</div>
            <div style={{ marginTop: 8, fontSize: 13 }}>
              {activeStrategy.symbol} · {activeStrategy.timeframe} · {activeStrategy.leverage}x · {activeStrategy.strategy_type === 'turtle' ? '海龟策略' : '经典策略'}
            </div>
          </div>
          <div style={summaryPanel}>
            <div style={statLabel}>交易状态</div>
            <div style={{ ...statValue, marginTop: 6 }}>{dashboard.runner?.enabled ? ((dashboard.runner as any)?.trade_mode === 'live' ? (dashboard.runner?.is_running ? '实盘自动执行中' : '实盘已启用待执行') : (dashboard.runner?.is_running ? '模拟自动执行中' : '模拟已启用待执行')) : '未启用'}</div>
            <div style={{ marginTop: 8, fontSize: 13 }}>下次执行：{formatUnixTs(dashboard.runner?.next_run_eta)}</div>
            <div style={{ marginTop: 8, fontSize: 13 }}>交易对：{dashboard.runner?.selected_symbols?.join(' / ') || activeStrategy.symbol}</div>
          </div>
          <div style={summaryPanel}>
            <div style={statLabel}>最近执行判断</div>
            <div style={{ ...statValue, marginTop: 6 }}>{latestRunnerPayload?.action || latestRunnerPayload?.reason || '暂无执行'}</div>
            <div style={{ marginTop: 8, fontSize: 13 }}>{latestRunnerPayload ? renderRunnerExecutionSummary(latestRunnerLog?.result) : '先运行一次策略或等待 Runner 产生日志。'}</div>
          </div>
          <div style={summaryPanel}>
            <div style={statLabel}>最近复盘结果</div>
            <div style={{ ...statValue, marginTop: 6 }}>{latestClosedPosition ? formatMoney(latestClosedPosition.realized_pnl) : backtest ? `${backtest.summary.return_pct}%` : '-'}</div>
            <div style={{ marginTop: 8, fontSize: 13 }}>
              {latestClosedPosition
                ? `${latestClosedPosition.symbol} ${latestClosedPosition.side} · ${latestClosedPosition.status}`
                : backtest
                  ? `回测交易 ${backtest.summary.trades} 笔 / 胜率 ${backtest.summary.win_rate_pct}%`
                  : '暂无最近平仓或回测结果'}
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 16 }}>
          <div style={summaryPanel}>
            <div style={{ fontWeight: 800, marginBottom: 8 }}>最近一次决策解释</div>
            <div style={{ display: 'grid', gap: 8, fontSize: 13, lineHeight: 1.65 }}>
              <div><strong>动作 / 信号：</strong>{latestRunnerPayload?.action || '-'} / {String(latestRunnerPayload?.signal ?? '-')}</div>
              <div><strong>价格：</strong>{latestRunnerPayload?.price ?? '-'} / <strong>数据源：</strong><span style={{ color: marketDataStatusColor(latestRunnerPayload?.market_data), fontWeight: 800 }}>{formatMarketDataStatus(latestRunnerPayload?.market_data)}</span></div>
              <div><strong>事件落地：</strong>{latestRunnerEvent ? renderRunnerEventSummary(latestRunnerLog?.result) : '暂无事件写入'}</div>
              {latestRunnerPayload?.market_data?.warning ? <div style={{ color: '#b45309' }}><strong>警告：</strong>{latestRunnerPayload.market_data.warning}</div> : null}
            </div>
          </div>
          <div style={summaryPanel}>
            <div style={{ fontWeight: 800, marginBottom: 8 }}>最近交易回放</div>
            {latestClosedPosition ? (
              <div style={{ display: 'grid', gap: 8, fontSize: 13, lineHeight: 1.65 }}>
                <div><strong>{latestClosedPosition.symbol}</strong> / {latestClosedPosition.side} / {latestClosedPosition.leverage}x</div>
                <div>开仓：{Number(latestClosedPosition.entry_price ?? 0).toFixed(2)} → 平仓：{latestClosedPosition.close_price == null ? '-' : Number(latestClosedPosition.close_price).toFixed(2)}</div>
                <div>净收益：{formatMoney(latestClosedPosition.realized_pnl)} / 手续费：{formatMoney(latestClosedPosition.cumulative_fees)}</div>
                <div>滑点损耗：{formatMoney(latestClosedPosition.cumulative_slippage_cost)}</div>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: '#64748b' }}>暂无已结束仓位，先跑一次执行或查看历史。</div>
            )}
          </div>
        </div>

        <StrategyForm
          initial={activeStrategy}
          onSave={onSave}
          onRunBacktest={onRunBacktest}
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
            },
            locked: item.locked ?? false,
          }))}
          onStrategySlotChange={onStrategySlotChange}
          onStrategySlotNameChange={onStrategySlotNameChange}
          onAddStrategySlot={onAddStrategySlot}
          onDeleteStrategySlot={onDeleteStrategySlot}
        />

        <div style={{ marginTop: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={onRunStrategyOnce} style={primaryButtonStyle}>运行一次策略执行</button>
          <button
            onClick={() => {
              const enabling = !(dashboard.runner?.enabled ?? false)
              onToggleRunner(
                enabling,
                enabling ? (activeStrategy.symbols && activeStrategy.symbols.length > 0 ? activeStrategy.symbols : [activeStrategy.symbol]) : undefined,
                enabling ? undefined : (dashboard.runner as any)?.trade_mode,
              )
            }}
            style={{ ...secondaryButtonStyle, background: dashboard.runner?.enabled ? '#dc2626' : '#2563eb', color: '#fff' }}
          >
            {dashboard.runner?.enabled ? '暂停机器人并市价平仓' : '开启自动运行标记'}
          </button>
          {dashboard.runner?.manual_resume_required ? (
            <button onClick={onResumeRunner} style={{ ...secondaryButtonStyle, background: '#d97706', color: '#fff' }}>手动恢复 Runner</button>
          ) : null}
        </div>

        {runnerResult ? (
          <div style={{ ...summaryPanel, marginTop: 16, display: 'grid', gap: 8, fontSize: 13, lineHeight: 1.6 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span style={chipStyle({ color: activeStrategy.strategy_type === 'turtle' ? '#7c3aed' : activeStrategy.strategy_type === 'ict' ? '#059669' : '#1d4ed8', background: activeStrategy.strategy_type === 'turtle' ? 'rgba(124,58,237,0.12)' : activeStrategy.strategy_type === 'ict' ? 'rgba(5,150,105,0.12)' : 'rgba(59,130,246,0.12)' })}>
                {activeStrategy.strategy_type === 'turtle' ? '当前执行：海龟策略' : activeStrategy.strategy_type === 'ict' ? '当前执行：ICT三周期策略' : '当前执行：经典策略'}
              </span>
              <span style={chipStyle({ color: '#0f766e', background: 'rgba(20,184,166,0.12)' })}>
                {activeStrategy.symbol} · {activeStrategy.timeframe} · {activeStrategy.leverage}x
              </span>
              {activeStrategy.strategy_type === 'turtle' ? (
                <span style={chipStyle({ color: '#6d28d9', background: 'rgba(139,92,246,0.12)' })}>
                  Entry {activeStrategy.turtle_entry_period} / Exit {activeStrategy.turtle_exit_period} / ATR {activeStrategy.turtle_atr_period}
                </span>
              ) : activeStrategy.strategy_type === 'ict' ? (
                <span style={chipStyle({ color: '#047857', background: 'rgba(5,150,105,0.10)' })}>
                  BOS {activeStrategy.ict_bos_lookback ?? 20} / RR 1:{activeStrategy.ict_risk_reward ?? 2.5}
                </span>
              ) : (
                <span style={chipStyle({ color: '#b45309', background: 'rgba(245,158,11,0.14)' })}>
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
    </div>
  )
}

export function RunnerStatusCard({ runner }: { runner?: DashboardRunner }) {
  const lastRunnerResult = runner?.last_result
  const lastRunnerEvent = getRunnerEvent(lastRunnerResult)
  const lastRunnerPayload = getRunnerPayload(lastRunnerResult)
  const tradeMode = runner?.trade_mode || 'paper'
  const modeLabel = tradeMode === 'live' ? '实盘' : '模拟'

  return (
    <div style={cardStyle}>
      {panelHeader(
        'Runner 状态',
        '自动执行、调度与最近一次事件回执。',
        <div style={{ ...pillBase, background: runner?.is_running ? (tradeMode === 'live' ? 'rgba(245,158,11,0.14)' : 'rgba(16,185,129,0.14)') : 'rgba(148,163,184,0.14)', color: runner?.is_running ? (tradeMode === 'live' ? '#b45309' : '#047857') : '#475569' }}>
          {runner?.is_running ? `${modeLabel}运行中` : runner?.enabled ? `${modeLabel}已启用` : '空闲'}
        </div>,
      )}

      <div style={statGrid}>
        <StatBlock label="启用标记" value={runner?.enabled ? '是' : '否'} />
        <StatBlock label="交易对组合" value={runner?.selected_symbols?.join(' / ') || '-'} />
        <StatBlock label="累计执行" value={String(runner?.loop_count ?? 0)} />
        <StatBlock label="最近执行" value={runner?.last_run_at || '-'} />
        <StatBlock label="下次执行" value={formatUnixTs(runner?.next_run_eta)} />
        <StatBlock label="最近执行 K 线" value={formatUnixTs(runner?.last_executed_candle_eta)} />
        <StatBlock label="需要手动恢复" value={runner?.manual_resume_required ? '是' : '否'} />
      </div>

      <div style={{ marginTop: 14, display: 'grid', gap: 10, fontSize: 14 }}>
        <div>
          市场数据源：
          <span style={{ color: marketDataStatusColor(lastRunnerPayload?.market_data), fontWeight: 800 }}>
            {formatMarketDataStatus(lastRunnerPayload?.market_data)}
          </span>
        </div>
        {lastRunnerPayload?.market_data?.warning ? <div style={{ color: '#d97706' }}>数据警告：{lastRunnerPayload.market_data.warning}</div> : null}
        <div style={{ ...pillBase, width: 'fit-content', background: runner?.guard?.allowed ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)', color: runner?.guard?.allowed ? '#15803d' : '#b91c1c' }}>
          熔断状态：{runner?.guard?.allowed ? '正常' : `停止 (${runner?.guard?.halt_reason})`}
        </div>
        {runner?.last_error ? <div style={{ color: '#b91c1c' }}>最近错误：{runner.last_error}</div> : null}
        {lastRunnerPayload ? <div style={summaryPanel}>最近执行摘要：{renderRunnerExecutionSummary(lastRunnerResult)}</div> : null}
        {lastRunnerEvent ? (
          <div style={summaryPanel}>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>最近写入事件</div>
            <div>事件类型：{lastRunnerEvent.event_type || '-'}</div>
            <div>来源：{lastRunnerEvent.source || '-'}</div>
            <div>仓位ID：{lastRunnerEvent.position_id || '-'}</div>
            <div>事件详情：{renderRunnerEventSummary(lastRunnerResult)}</div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function RunnerGuardCard({ runner }: { runner?: DashboardRunner }) {
  const danger = Number(runner?.guard?.daily_loss_ratio ?? 0) > 0.05 || Number(runner?.guard?.exposure_ratio ?? 0) > 2

  return (
    <div style={cardStyle}>
      {panelHeader(
        '高级风控',
        '连续亏损、日内损益与敞口约束。',
        <div style={{ ...pillBase, background: danger ? 'rgba(239,68,68,0.12)' : 'rgba(34,197,94,0.12)', color: danger ? '#b91c1c' : '#15803d' }}>
          {danger ? '注意风险' : '风险可控'}
        </div>,
      )}

      <div style={statGrid}>
        <StatBlock label="连续亏损次数" value={String(runner?.guard?.consecutive_loss_count ?? 0)} />
        <StatBlock label="24h 已实现盈亏" value={formatMoney(runner?.guard?.daily_realized_pnl)} />
        <StatBlock label="24h 亏损占比" value={`${(Number(runner?.guard?.daily_loss_ratio ?? 0) * 100).toFixed(2)}%`} />
        <StatBlock label="当前总名义敞口" value={formatMoney(runner?.guard?.total_notional)} />
        <StatBlock label="总敞口 / 权益" value={`${(Number(runner?.guard?.exposure_ratio ?? 0) * 100).toFixed(2)}%`} />
      </div>
    </div>
  )
}

export function SupportScopeCard({ dashboard }: { dashboard: DashboardData }) {
  return (
    <div style={cardStyle}>
      {panelHeader('支持范围', '明确当前策略工作台支持的交易对、周期与杠杆边界。')}
      <div style={{ display: 'grid', gap: 12 }}>
        <div style={summaryPanel}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {dashboard.supported_symbols.map((symbol) => (
              <span key={symbol} style={chipStyle({ color: '#1d4ed8', background: 'rgba(59,130,246,0.12)' })}>{symbol}</span>
            ))}
          </div>
        </div>
        <div style={summaryPanel}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {dashboard.supported_timeframes.map((timeframe) => (
              <span key={timeframe} style={chipStyle({ color: '#7c3aed', background: 'rgba(124,58,237,0.12)' })}>{timeframe}</span>
            ))}
          </div>
        </div>
        <div style={summaryPanel}>杠杆范围：1 - 100</div>
      </div>
    </div>
  )
}

export function BacktestSummaryCard({ backtest }: { backtest: BacktestResult | null }) {
  return (
    <div style={cardStyle}>
      {panelHeader(
        '回测结果',
        '收益、回撤、数据源、风险校验与选定周期表现。',
        backtest ? (
          <div style={{ ...pillBase, background: backtest.risk.allowed ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)', color: backtest.risk.allowed ? '#15803d' : '#b91c1c' }}>
            {backtest.risk.allowed ? '风险通过' : '风险拒绝'}
          </div>
        ) : null,
      )}
      {!backtest ? (
        <p style={{ color: '#6b7280' }}>点击“运行回测”后展示结果</p>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            <span style={chipStyle({ color: backtest.input.strategy_type === 'turtle' ? '#7c3aed' : '#1d4ed8', background: backtest.input.strategy_type === 'turtle' ? 'rgba(124,58,237,0.12)' : 'rgba(59,130,246,0.12)' })}>
              {backtest.input.strategy_type === 'turtle' ? '海龟策略' : '经典策略'}
            </span>
            <span style={chipStyle({ color: '#0f766e', background: 'rgba(20,184,166,0.12)' })}>
              {backtest.input.symbol || '-'} · {backtest.input.timeframe || '-'}
            </span>
            {backtest.input.strategy_type === 'turtle' ? (
              <span style={chipStyle({ color: '#6d28d9', background: 'rgba(139,92,246,0.12)' })}>
                Entry {backtest.input.turtle_entry_period ?? '-'} / Exit {backtest.input.turtle_exit_period ?? '-'} / ATR {backtest.input.turtle_atr_period ?? '-'}
              </span>
            ) : (
              <span style={chipStyle({ color: '#b45309', background: 'rgba(245,158,11,0.14)' })}>
                {[
                  backtest.input.use_boll ? `BOLL ${backtest.input.boll_period ?? '-'} / ${backtest.input.boll_std ?? '-'}` : null,
                  backtest.input.use_rsi ? `RSI ${backtest.input.rsi_period ?? '-'}` : null,
                  backtest.input.use_ma ? `MA ${backtest.input.ma_short ?? '-'} / ${backtest.input.ma_long ?? '-'}` : null,
                ].filter(Boolean).join(' ｜ ') || '未启用经典指标条件'}
              </span>
            )}
          </div>
          <div style={statGrid}>
            <StatBlock label="回测周期" value={`${backtest.input.backtest_days ?? 7}天`} />
            <StatBlock label="收益率" value={`${backtest.summary.return_pct}%`} />
            <StatBlock label="最大回撤" value={`${backtest.summary.max_drawdown_pct}%`} />
            <StatBlock label="交易次数" value={String(backtest.summary.trades)} />
            <StatBlock label="盈利" value={formatMoney(backtest.summary.net_pnl ?? backtest.summary.total_net_pnl)} />
          </div>
          <div style={{ marginTop: 14, display: 'grid', gap: 8, fontSize: 14 }}>
            <div>请求数据源：{backtest.input.data_source}</div>
            <div>
              实际数据源：
              <span style={{ color: marketDataStatusColor(backtest.market_data), fontWeight: 800 }}>
                {formatMarketDataStatus(backtest.market_data)}
              </span>
            </div>
            {backtest.market_data?.warning ? <div style={{ color: '#d97706' }}>数据警告：{backtest.market_data.warning}</div> : null}
            <div style={summaryPanel}>{renderCostSummaryRows(backtest.summary)}</div>
            <div>结束权益：{formatMoney(backtest.summary.ending_equity)}</div>
          </div>
        </>
      )}
    </div>
  )
}

export function BacktestRiskCard({ backtest }: { backtest: BacktestResult | null }) {
  return (
    <div style={cardStyle}>
      {panelHeader('风险提示', '聚焦回测风控口径：杠杆、保证金、最大亏损、风险占比。')}
      {!backtest ? (
        <p style={{ color: '#6b7280' }}>运行回测后显示风险结果</p>
      ) : (
        <div style={statGrid}>
          <StatBlock label="杠杆" value={`${backtest.risk.leverage}x`} />
          <StatBlock label="初始保证金" value={formatMoney(backtest.risk.initial_margin)} />
          <StatBlock label="最大亏损" value={formatMoney(backtest.risk.max_loss)} />
          <StatBlock label="风险占权益比" value={`${(Number(backtest.risk.equity_risk_ratio) * 100).toFixed(2)}%`} />
        </div>
      )}
    </div>
  )
}

export function BacktestTradesCard({ backtest }: { backtest: BacktestResult | null }) {
  return (
    <div style={cardStyle}>
      {panelHeader('回测交易列表', '按交易条目复盘开平仓价格、原因与成本结构。')}
      {!backtest || !backtest.trades || backtest.trades.length === 0 ? (
        <p style={{ color: '#6b7280' }}>暂无交易记录</p>
      ) : (
        <div style={timelineList}>
          {backtest.trades.map((trade, idx) => (
            <div key={idx} style={timelineCard}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <strong style={{ fontSize: 15, color: '#0f172a' }}>{backtest.input.symbol || '-'}</strong>
                  <span style={chipStyle({ color: trade.side === 'long' ? '#1d4ed8' : '#7c3aed', background: trade.side === 'long' ? 'rgba(59,130,246,0.12)' : 'rgba(124,58,237,0.12)' })}>{trade.side}</span>
                  <span style={chipStyle({ color: '#334155', background: 'rgba(148,163,184,0.18)' })}>{trade.status || 'closed'}</span>
                  <span style={chipStyle({ color: '#0f172a', background: 'rgba(15,23,42,0.08)' })}>{trade.leverage ?? backtest.input.leverage ?? 1}x</span>
                </div>
                <div style={{ fontWeight: 800, color: Number(trade.pnl ?? 0) >= 0 ? '#166534' : '#b91c1c' }}>{formatMoney(trade.pnl)}</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginTop: 12 }}>
                <StatBlock label="开仓价" value={Number(trade.entry_price ?? 0).toFixed(2)} />
                <StatBlock label="平仓价" value={Number(trade.exit_price ?? 0).toFixed(2)} />
                <StatBlock label="数量" value={Number(trade.qty ?? 0).toFixed(6)} />
                <StatBlock label="手续费" value={formatMoney(trade.cumulative_fees ?? trade.fee)} />
                <StatBlock label="滑点损耗" value={formatMoney(trade.cumulative_slippage_cost ?? calcTradeSlippageCost(trade))} />
                <StatBlock label="平仓原因" value={trade.reason || '-'} />
              </div>
              <div style={{ marginTop: 12, padding: 12, borderRadius: 14, background: 'rgba(241,245,249,0.78)', color: '#334155', fontSize: 13, lineHeight: 1.6 }}>
                <div><strong>开仓时间：</strong>{trade.entry_time || '-'}</div>
                <div style={{ marginTop: 6 }}><strong>平仓时间：</strong>{trade.exit_time || '-'}</div>
                <div style={{ marginTop: 6 }}><strong>持仓复盘：</strong>{backtest.input.symbol || '-'} {trade.side} {trade.leverage ?? backtest.input.leverage ?? 1}x 从 {Number(trade.entry_price ?? 0).toFixed(2)} 开仓，在 {Number(trade.exit_price ?? 0).toFixed(2)} 平仓，净收益 {formatMoney(trade.pnl)}。</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
