import type React from 'react'
import { useMemo, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

import type { DashboardData, EquityPoint, HistoryFilters, HistoryStats, MarketTickers } from './dashboard-types'
import { buildCurvePath, formatDateTime, formatMoney, readPositionTargetPrice, renderCostSummaryRows, resolveLivePositionPrice } from './dashboard-utils'

function derivePositionTarget(position: DashboardData['positions'][number], metaKey: 'stop_loss_price' | 'take_profit_price', fallbackPct: number) {
  const persistedTarget = readPositionTargetPrice(position.open_order_meta_json, metaKey)
  if (persistedTarget != null) return persistedTarget
  if (metaKey === 'stop_loss_price') {
    return position.side === 'long'
      ? position.entry_price * (1 - fallbackPct)
      : position.entry_price * (1 + fallbackPct)
  }
  return position.side === 'long'
    ? position.entry_price * (1 + fallbackPct)
    : position.entry_price * (1 - fallbackPct)
}

function readRunnerConfigNumber(config: Record<string, unknown> | null | undefined, key: string) {
  const value = Number(config?.[key])
  return Number.isFinite(value) ? value : null
}

function readRunnerConfigBoolean(config: Record<string, unknown> | null | undefined, key: string) {
  const value = config?.[key]
  return typeof value === 'boolean' ? value : null
}

function readRunnerConfigSymbols(config: Record<string, unknown> | null | undefined) {
  const value = config?.symbols
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join(' / ')
  }
  const symbol = config?.symbol
  return typeof symbol === 'string' ? symbol : '-'
}

function buildCurvePoints(equityCurve: EquityPoint[]) {
  if (equityCurve.length === 0) return []

  const width = 520
  const height = 180
  const padding = 12
  const values = equityCurve.map((item) => item.equity)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1

  return equityCurve.map((item, index) => {
    const x = padding + (index / Math.max(equityCurve.length - 1, 1)) * (width - padding * 2)
    const y = height - padding - ((item.equity - min) / range) * (height - padding * 2)
    return { x, y, item, index }
  })
}

function panelHeader(title: string, hint: string, right?: React.ReactNode) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
      <div>
        <h2 className="text-lg font-extrabold text-text-primary">{title}</h2>
        <p className="text-xs text-text-muted mt-1">{hint}</p>
      </div>
      {right}
    </div>
  )
}

function MetricTile({ label, value, positive }: { label: string; value: string | number; positive?: boolean }) {
  return (
    <div className="grid gap-1.5 p-3.5 rounded-2xl bg-bg-card/80 border border-border">
      <div className="text-xs text-text-secondary">{label}</div>
      <div className={`text-base font-extrabold ${positive === undefined ? 'text-text-primary' : positive ? 'text-accent-green' : 'text-accent-red'}`}>{value}</div>
    </div>
  )
}

const toInt = (value: number) => Math.round(value)
const toIntMoney = (value: number) => `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const toPrice = (value: number) => value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function readRunnerStatusSymbols(runner: DashboardData['runner']) {
  const selected = runner?.selected_symbols
  if (selected && selected.length > 0) return selected.join(' / ')
  const current = runner?.current_strategy_config
  return readRunnerConfigSymbols(current)
}

export function PositionsOverviewCard({
  dashboard,
  positionsOverride,
  marketTickers,
  riskConfig,
  onClosePosition,
  onCloseAll,
}: {
  dashboard: DashboardData
  positionsOverride?: DashboardData['positions']
  marketTickers?: MarketTickers
  riskConfig: { stopLossPct: number; takeProfitPct: number }
  onClosePosition?: (payload: { symbol: 'BTC_USDT' | 'ETH_USDT'; price: number; position_id?: string }) => Promise<void>
  onCloseAll?: () => Promise<void>
}) {
  const positions = positionsOverride ?? dashboard.positions
  const runnerStatusSymbols = readRunnerStatusSymbols(dashboard.runner)
  const isLiveMode = dashboard.trade_mode === 'live'

  return (
    <div className="rounded-2xl bg-bg-card border border-border p-5">
      {panelHeader(
        '当前持仓',
        '聚焦当前仓位风险、盈亏和强平距离，快速判断账户是否需要减仓。',
        positions.length > 0 && onCloseAll ? (
          <button
            type="button"
            onClick={onCloseAll}
            className="px-4.5 py-2.5 rounded-xl bg-accent-red text-white font-extrabold cursor-pointer whitespace-nowrap"
          >
            一键平仓
          </button>
        ) : undefined,
      )}
      <div className="p-3.5 rounded-2xl bg-bg-card/80 border border-border text-text-secondary mb-3">
        <div className="font-extrabold mb-1.5">当前 Runner 选中交易对</div>
        <div className="text-base font-extrabold text-text-primary">{runnerStatusSymbols || '-'}</div>
      </div>
      <div className="grid gap-3">
        {positions.length === 0 ? (
          <p className="text-text-muted">暂无持仓</p>
        ) : positions.map((position, index) => {
          const livePrice = resolveLivePositionPrice(position, marketTickers)
          const unrealizedPnl = position.unrealized_pnl ?? (position.side === 'long'
            ? (livePrice - position.entry_price) * position.qty
            : (position.entry_price - livePrice) * position.qty)
          const margin = position.margin ?? position.initial_margin
          const pnlReturnRatio = margin > 0 ? unrealizedPnl / margin : 0
          const unrealizedPnlPct = position.entry_price > 0
            ? (position.side === 'long' ? (livePrice - position.entry_price) : (position.entry_price - livePrice)) / position.entry_price
            : 0
          const stopLossPrice = position.stop_loss_price ?? derivePositionTarget(position, 'stop_loss_price', riskConfig.stopLossPct)
          const takeProfitPrice = position.take_profit_price ?? derivePositionTarget(position, 'take_profit_price', riskConfig.takeProfitPct)
          const hasPersistedTargets = Number(position.stop_loss_price) > 0 && Number(position.take_profit_price) > 0
          const slDistancePct = position.entry_price > 0
            ? (position.side === 'long' ? (livePrice - stopLossPrice) : (stopLossPrice - livePrice)) / position.entry_price
            : 0
          const liqPrice = position.liq_price ?? position.liquidation_price
          const liqDistPct = liqPrice > 0 && livePrice > 0
            ? Math.abs(livePrice - liqPrice) / livePrice
            : 0
          const liquidationLabel = isLiveMode ? '交易所强平价' : '模拟强平价（估算）'
          const liquidationDistanceLabel = isLiveMode ? '距交易所强平' : '距模拟强平'
          const conditionalStatus = position.conditional_order_status
          const hasMissingConditionalOrder = isLiveMode && conditionalStatus && (conditionalStatus.stop_loss === 'missing' || conditionalStatus.take_profit === 'missing')

          return (
            <div key={position.position_id || `${position.symbol}-${position.side}-${index}`} className="p-3.5 rounded-2xl bg-bg-card/80 border border-border text-text-secondary">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="text-lg text-text-primary">{position.symbol}</strong>
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${position.side === 'long' ? 'text-accent-green bg-accent-green/12' : 'text-accent-red bg-accent-red/12'}`}>
                    {position.side.toUpperCase()}
                  </span>
                  <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold text-accent-blue bg-accent-blue/12">{toInt(position.leverage)}x</span>
                </div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <div className={`font-extrabold ${unrealizedPnl >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>{toIntMoney(unrealizedPnl)}</div>
                </div>
              </div>

              <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
                <MetricTile label="开仓价" value={toPrice(position.entry_price)} />
                <MetricTile label="当前价格" value={toPrice(livePrice)} />
                <MetricTile label="数量" value={toInt(position.qty)} />
                <MetricTile label="实际止损触发价" value={toPrice(stopLossPrice)} />
                <MetricTile label="实际止盈触发价" value={toPrice(takeProfitPrice)} />
                <MetricTile label="距止损" value={`${(slDistancePct * 100).toFixed(2)}%`} positive={slDistancePct >= 0.01} />
                <MetricTile label="未实现盈亏" value={`${(unrealizedPnlPct * 100).toFixed(2)}%`} positive={unrealizedPnlPct >= 0} />
                <MetricTile label="保证金" value={toIntMoney(margin)} />
                <MetricTile label="未实现盈亏" value={toIntMoney(unrealizedPnl)} positive={unrealizedPnl >= 0} />
                <MetricTile label="收益/保证金" value={`${toInt(pnlReturnRatio * 100)}%`} positive={pnlReturnRatio >= 0} />
                {liqPrice > 0 && <MetricTile label={liquidationLabel} value={toPrice(liqPrice)} />}
                {liqDistPct > 0 && <MetricTile label={liquidationDistanceLabel} value={`${(liqDistPct * 100).toFixed(2)}%`} positive={liqDistPct >= 0.05} />}
              </div>
              <div className="mt-2.5 text-xs text-text-muted leading-relaxed">
                {hasMissingConditionalOrder ? (
                  <div className="mb-2 text-accent-red font-extrabold">
                    ??????????? {conditionalStatus?.stop_loss || '-'}??? {conditionalStatus?.take_profit || '-'}?????????????
                  </div>
                ) : null}
                {hasPersistedTargets
                  ? '当前显示的是后端持仓记录里的真实触发价，机器人止损/止盈会优先按这两个价格判断。'
                  : '当前显示的是根据开仓价和策略参数推导出的触发价；若后端已保存真实触发价，会优先使用真实值。'}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function HistoryFilterCard({
  historyFilters,
  setHistoryFilters,
}: {
  historyFilters: HistoryFilters
  setHistoryFilters: Dispatch<SetStateAction<HistoryFilters>>
}) {
  return (
    <div className="rounded-2xl bg-bg-card border border-border p-5">
      {panelHeader(
        '历史筛选',
        '统一筛选订单和持仓历史，复盘时先收窄样本，再看结果卡片。',
        <button
          onClick={() => setHistoryFilters({ symbol: '', status: '', event_type: '', source: '', start_time: '', end_time: '', trade_mode: '' })}
          className="px-3.5 py-2.5 rounded-xl bg-text-muted text-white font-extrabold"
        >
          清空筛选
        </button>,
      )}

      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <label className="grid gap-1.5">
          <span className="text-xs text-text-secondary">模式</span>
          <select value={historyFilters.trade_mode} onChange={(e) => setHistoryFilters((prev) => ({ ...prev, trade_mode: e.target.value }))} className="px-3 py-2.5 rounded-xl border border-border bg-bg-card text-text-primary">
            <option value="">全部</option>
            <option value="paper">模拟</option>
            <option value="live">实盘</option>
          </select>
        </label>
        <label className="grid gap-1.5">
          <span className="text-xs text-text-secondary">交易对</span>
          <select value={historyFilters.symbol} onChange={(e) => setHistoryFilters((prev) => ({ ...prev, symbol: e.target.value }))} className="px-3 py-2.5 rounded-xl border border-border bg-bg-card text-text-primary">
            <option value="">全部</option>
            <option value="BTC_USDT">BTC_USDT</option>
            <option value="ETH_USDT">ETH_USDT</option>
          </select>
        </label>
        <label className="grid gap-1.5">
          <span className="text-xs text-text-secondary">状态</span>
          <select value={historyFilters.status} onChange={(e) => setHistoryFilters((prev) => ({ ...prev, status: e.target.value }))} className="px-3 py-2.5 rounded-xl border border-border bg-bg-card text-text-primary">
            <option value="">全部</option>
            <option value="open">open</option>
            <option value="closed">closed</option>
            <option value="filled">filled</option>
            <option value="mark">mark</option>
          </select>
        </label>
        <label className="grid gap-1.5">
          <span className="text-xs text-text-secondary">事件类型</span>
          <select value={historyFilters.event_type} onChange={(e) => setHistoryFilters((prev) => ({ ...prev, event_type: e.target.value }))} className="px-3 py-2.5 rounded-xl border border-border bg-bg-card text-text-primary">
            <option value="">全部</option>
            <option value="open">open</option>
            <option value="mark">mark</option>
            <option value="close">close</option>
          </select>
        </label>
        <label className="grid gap-1.5">
          <span className="text-xs text-text-secondary">来源</span>
          <select value={historyFilters.source} onChange={(e) => setHistoryFilters((prev) => ({ ...prev, source: e.target.value }))} className="px-3 py-2.5 rounded-xl border border-border bg-bg-card text-text-primary">
            <option value="">全部</option>
            <option value="manual">manual</option>
            <option value="runner">runner</option>
          </select>
        </label>
        <label className="grid gap-1.5">
          <span className="text-xs text-text-secondary">开始时间</span>
          <input type="datetime-local" value={historyFilters.start_time} onChange={(e) => setHistoryFilters((prev) => ({ ...prev, start_time: e.target.value }))} className="px-3 py-2.5 rounded-xl border border-border bg-bg-card text-text-primary" />
        </label>
        <label className="grid gap-1.5">
          <span className="text-xs text-text-secondary">结束时间</span>
          <input type="datetime-local" value={historyFilters.end_time} onChange={(e) => setHistoryFilters((prev) => ({ ...prev, end_time: e.target.value }))} className="px-3 py-2.5 rounded-xl border border-border bg-bg-card text-text-primary" />
        </label>
      </div>
    </div>
  )
}

export function HistoryStatsCard({ historyStats }: { historyStats: HistoryStats | null }) {
  return (
    <div className="rounded-2xl bg-bg-card border border-border p-5">
      {panelHeader('历史统计', '交易结果、成本结构与回撤概览。')}
      {!historyStats ? (
        <p className="text-text-muted">暂无统计数据</p>
      ) : (
        <>
          <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
            <MetricTile label="总交易数" value={String(historyStats.total_trades)} />
            <MetricTile label="胜率" value={`${(historyStats.win_rate * 100).toFixed(2)}%`} positive={historyStats.win_rate >= 0.5} />
            <MetricTile label="平均每笔净收益" value={formatMoney(historyStats.avg_pnl_per_trade)} positive={historyStats.avg_pnl_per_trade >= 0} />
            <MetricTile label="最大回撤" value={`${(historyStats.max_drawdown_ratio * 100).toFixed(2)}%`} positive={historyStats.max_drawdown_ratio <= 0.1} />
          </div>
          <div className="mt-3.5 grid gap-2.5 text-sm">
            <div className="p-3.5 rounded-2xl bg-bg-card/80 border border-border text-text-secondary">盈利笔数：{historyStats.win_trades} ｜ 亏损笔数：{historyStats.loss_trades}</div>
            <div className="p-3.5 rounded-2xl bg-bg-card/80 border border-border text-text-secondary">{renderCostSummaryRows(historyStats)}</div>
            <div className="p-3.5 rounded-2xl bg-bg-card/80 border border-border text-text-secondary">平均每笔手续费：{formatMoney(historyStats.avg_fee_per_trade)} ｜ 平均每笔滑点损耗：{formatMoney(historyStats.avg_slippage_cost_per_trade)}</div>
            <div className="p-3.5 rounded-2xl bg-bg-card/80 border border-border text-text-secondary">最大单笔盈利：{formatMoney(historyStats.max_profit_trade)} ｜ 最大单笔亏损：{formatMoney(historyStats.max_loss_trade)}</div>
            <div className="p-3.5 rounded-2xl bg-bg-card/80 border border-border text-text-secondary">权益曲线点数：{historyStats.equity_points}</div>
          </div>
        </>
      )}
    </div>
  )
}

export function EquityCurveCard({ equityCurve }: { equityCurve: EquityPoint[] }) {
  const curvePath = buildCurvePath(equityCurve)
  const curvePoints = useMemo(() => buildCurvePoints(equityCurve), [equityCurve])
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  const hoveredPoint = hoveredIndex != null ? curvePoints[hoveredIndex] : null

  return (
    <div className="rounded-2xl bg-bg-card border border-border p-5">
      {panelHeader('权益曲线', '观察权益变化轨迹，判断策略执行是否平滑，是否出现明显回撤。')}
      {equityCurve.length === 0 ? (
        <p className="text-text-muted">暂无曲线数据，先跑几次模拟交易或策略执行</p>
      ) : (
        <>
          <div className="relative p-3 rounded-2xl bg-bg-card/80 border border-border text-text-secondary">
            <svg
              viewBox="0 0 520 180"
              className="w-full h-[180px] rounded-[14px] overflow-visible"
              style={{ background: 'linear-gradient(180deg, rgba(30,41,59,0.5) 0%, rgba(15,23,42,0.3) 100%)' }}
              onMouseLeave={() => setHoveredIndex(null)}
              onMouseMove={(event) => {
                const rect = event.currentTarget.getBoundingClientRect()
                const ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0
                const nextIndex = Math.min(
                  curvePoints.length - 1,
                  Math.max(0, Math.round(ratio * Math.max(curvePoints.length - 1, 0))),
                )
                setHoveredIndex(nextIndex)
              }}
            >
              <path d={curvePath} fill="none" stroke="#2563eb" strokeWidth="3" />
              {curvePoints.map((point) => (
                <circle
                  key={`${point.item.id}-${point.index}`}
                  cx={point.x}
                  cy={point.y}
                  r={hoveredIndex === point.index ? 5 : 0}
                  fill="#2563eb"
                  stroke="#ffffff"
                  strokeWidth="2"
                />
              ))}
              {hoveredPoint ? (
                <>
                  <line x1={hoveredPoint.x} y1="12" x2={hoveredPoint.x} y2="168" stroke="rgba(37,99,235,0.28)" strokeDasharray="4 4" />
                  <circle cx={hoveredPoint.x} cy={hoveredPoint.y} r="6" fill="#2563eb" stroke="#ffffff" strokeWidth="2.5" />
                </>
              ) : null}
            </svg>
            {hoveredPoint ? (
              <div
                className="absolute pointer-events-none px-3 py-2.5 rounded-xl bg-slate-900/95 text-slate-100 shadow-xl border border-border text-xs leading-relaxed"
                style={{
                  left: `clamp(12px, calc(${((hoveredPoint.x / 520) * 100).toFixed(2)}% - 70px), calc(100% - 180px))`,
                  top: 22,
                  minWidth: 170,
                }}
              >
                <div className="font-bold mb-1.5">{formatDateTime(hoveredPoint.item.created_at)}</div>
                <div>权益：{formatMoney(hoveredPoint.item.equity)}</div>
                <div>已实现盈亏：{formatMoney(hoveredPoint.item.realized_pnl)}</div>
                <div>未实现盈亏：{formatMoney(hoveredPoint.item.unrealized_pnl)}</div>
                <div>占用保证金：{formatMoney(hoveredPoint.item.margin_used)}</div>
              </div>
            ) : null}
          </div>
          <div className="grid gap-2.5 mt-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
            <MetricTile label="起点权益" value={formatMoney(equityCurve[0]?.equity)} />
            <MetricTile label="终点权益" value={formatMoney(equityCurve[equityCurve.length - 1]?.equity)} />
            <MetricTile label="采样点数" value={equityCurve.length} />
          </div>
        </>
      )}
    </div>
  )
}
