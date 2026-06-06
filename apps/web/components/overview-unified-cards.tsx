import type React from 'react'
import { useMemo, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

import type { DashboardData, EquityPoint, HistoryFilters, HistoryStats, MarketTickers } from './dashboard-types'
import { cardStyle, chipStyle, labelStyle, sectionHintStyle, sectionTitleStyle } from './dashboard-types'
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

const metricGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
  gap: 10,
}

const metricTileStyle: React.CSSProperties = {
  display: 'grid',
  gap: 6,
  padding: 14,
  borderRadius: 18,
  background: 'rgba(248,250,252,0.9)',
  border: '1px solid rgba(148,163,184,0.16)',
}

const metricValueStyle: React.CSSProperties = {
  fontWeight: 800,
  color: '#0f172a',
  fontSize: 16,
}

const panelStyle: React.CSSProperties = {
  padding: 14,
  borderRadius: 18,
  background: 'rgba(241,245,249,0.95)',
  border: '1px solid rgba(148,163,184,0.18)',
  color: '#334155',
}

const inputStyle: React.CSSProperties = {
  padding: '11px 12px',
  borderRadius: 12,
  border: '1px solid rgba(148,163,184,0.28)',
  background: '#fff',
  color: '#0f172a',
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
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
      <div>
        <h2 style={sectionTitleStyle}>{title}</h2>
        <p style={sectionHintStyle}>{hint}</p>
      </div>
      {right}
    </div>
  )
}

function MetricTile({ label, value, positive }: { label: string; value: string | number; positive?: boolean }) {
  return (
    <div style={metricTileStyle}>
      <div style={labelStyle}>{label}</div>
      <div style={{ ...metricValueStyle, color: positive === undefined ? '#0f172a' : positive ? '#166534' : '#b91c1c' }}>{value}</div>
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
    <div style={cardStyle}>
      {panelHeader(
        '当前持仓',
        '聚焦当前仓位风险、盈亏和强平距离，快速判断账户是否需要减仓。',
        positions.length > 0 && onCloseAll ? (
          <button
            type="button"
            onClick={onCloseAll}
            style={{ padding: '9px 18px', borderRadius: 12, border: 0, background: '#dc2626', color: '#fff', fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            一键平仓
          </button>
        ) : undefined,
      )}
      <div style={{ ...panelStyle, marginBottom: 12 }}>
        <div style={{ fontWeight: 800, marginBottom: 6 }}>当前 Runner 选中交易对</div>
        <div style={{ fontSize: 16, fontWeight: 800, color: '#0f172a' }}>{runnerStatusSymbols || '-'}</div>
      </div>
      <div style={{ display: 'grid', gap: 12 }}>
        {positions.length === 0 ? (
          <p style={{ color: '#6b7280' }}>暂无持仓</p>
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
            <div key={position.position_id || `${position.symbol}-${position.side}-${index}`} style={panelStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <strong style={{ fontSize: 18, color: '#0f172a' }}>{position.symbol}</strong>
                  <span style={chipStyle({ color: position.side === 'long' ? '#166534' : '#b91c1c', background: position.side === 'long' ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)' })}>
                    {position.side.toUpperCase()}
                  </span>
                  <span style={chipStyle({ color: '#1d4ed8', background: 'rgba(59,130,246,0.12)' })}>{toInt(position.leverage)}x</span>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ fontWeight: 800, color: unrealizedPnl >= 0 ? '#166534' : '#b91c1c' }}>{toIntMoney(unrealizedPnl)}</div>
                </div>
              </div>

              <div style={metricGridStyle}>
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
              <div style={{ marginTop: 10, fontSize: 12, color: '#64748b', lineHeight: 1.6 }}>
                {hasMissingConditionalOrder ? (
                  <div style={{ marginBottom: 8, color: '#b91c1c', fontWeight: 800 }}>
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
    <div style={cardStyle}>
      {panelHeader(
        '历史筛选',
        '统一筛选订单和持仓历史，复盘时先收窄样本，再看结果卡片。',
        <button
          onClick={() => setHistoryFilters({ symbol: '', status: '', event_type: '', source: '', start_time: '', end_time: '', trade_mode: '' })}
          style={{ padding: '11px 14px', borderRadius: 12, border: 0, background: '#6b7280', color: '#fff', fontWeight: 800 }}
        >
          清空筛选
        </button>,
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={labelStyle}>模式</span>
          <select value={historyFilters.trade_mode} onChange={(e) => setHistoryFilters((prev) => ({ ...prev, trade_mode: e.target.value }))} style={inputStyle}>
            <option value="">全部</option>
            <option value="paper">模拟</option>
            <option value="live">实盘</option>
          </select>
        </label>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={labelStyle}>交易对</span>
          <select value={historyFilters.symbol} onChange={(e) => setHistoryFilters((prev) => ({ ...prev, symbol: e.target.value }))} style={inputStyle}>
            <option value="">全部</option>
            <option value="BTC_USDT">BTC_USDT</option>
            <option value="ETH_USDT">ETH_USDT</option>
          </select>
        </label>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={labelStyle}>状态</span>
          <select value={historyFilters.status} onChange={(e) => setHistoryFilters((prev) => ({ ...prev, status: e.target.value }))} style={inputStyle}>
            <option value="">全部</option>
            <option value="open">open</option>
            <option value="closed">closed</option>
            <option value="filled">filled</option>
            <option value="mark">mark</option>
          </select>
        </label>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={labelStyle}>事件类型</span>
          <select value={historyFilters.event_type} onChange={(e) => setHistoryFilters((prev) => ({ ...prev, event_type: e.target.value }))} style={inputStyle}>
            <option value="">全部</option>
            <option value="open">open</option>
            <option value="mark">mark</option>
            <option value="close">close</option>
          </select>
        </label>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={labelStyle}>来源</span>
          <select value={historyFilters.source} onChange={(e) => setHistoryFilters((prev) => ({ ...prev, source: e.target.value }))} style={inputStyle}>
            <option value="">全部</option>
            <option value="manual">manual</option>
            <option value="runner">runner</option>
          </select>
        </label>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={labelStyle}>开始时间</span>
          <input type="datetime-local" value={historyFilters.start_time} onChange={(e) => setHistoryFilters((prev) => ({ ...prev, start_time: e.target.value }))} style={inputStyle} />
        </label>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={labelStyle}>结束时间</span>
          <input type="datetime-local" value={historyFilters.end_time} onChange={(e) => setHistoryFilters((prev) => ({ ...prev, end_time: e.target.value }))} style={inputStyle} />
        </label>
      </div>
    </div>
  )
}

export function HistoryStatsCard({ historyStats }: { historyStats: HistoryStats | null }) {
  return (
    <div style={cardStyle}>
      {panelHeader('历史统计', '交易结果、成本结构与回撤概览。')}
      {!historyStats ? (
        <p style={{ color: '#6b7280' }}>暂无统计数据</p>
      ) : (
        <>
          <div style={metricGridStyle}>
            <MetricTile label="总交易数" value={String(historyStats.total_trades)} />
            <MetricTile label="胜率" value={`${(historyStats.win_rate * 100).toFixed(2)}%`} positive={historyStats.win_rate >= 0.5} />
            <MetricTile label="平均每笔净收益" value={formatMoney(historyStats.avg_pnl_per_trade)} positive={historyStats.avg_pnl_per_trade >= 0} />
            <MetricTile label="最大回撤" value={`${(historyStats.max_drawdown_ratio * 100).toFixed(2)}%`} positive={historyStats.max_drawdown_ratio <= 0.1} />
          </div>
          <div style={{ marginTop: 14, display: 'grid', gap: 10, fontSize: 14 }}>
            <div style={panelStyle}>盈利笔数：{historyStats.win_trades} ｜ 亏损笔数：{historyStats.loss_trades}</div>
            <div style={panelStyle}>{renderCostSummaryRows(historyStats)}</div>
            <div style={panelStyle}>平均每笔手续费：{formatMoney(historyStats.avg_fee_per_trade)} ｜ 平均每笔滑点损耗：{formatMoney(historyStats.avg_slippage_cost_per_trade)}</div>
            <div style={panelStyle}>最大单笔盈利：{formatMoney(historyStats.max_profit_trade)} ｜ 最大单笔亏损：{formatMoney(historyStats.max_loss_trade)}</div>
            <div style={panelStyle}>权益曲线点数：{historyStats.equity_points}</div>
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
    <div style={cardStyle}>
      {panelHeader('权益曲线', '观察权益变化轨迹，判断策略执行是否平滑，是否出现明显回撤。')}
      {equityCurve.length === 0 ? (
        <p style={{ color: '#6b7280' }}>暂无曲线数据，先跑几次模拟交易或策略执行</p>
      ) : (
        <>
          <div style={{ ...panelStyle, padding: 12, position: 'relative' }}>
            <svg
              viewBox="0 0 520 180"
              style={{ width: '100%', height: 180, background: 'linear-gradient(180deg, #f8fbff 0%, #eff6ff 100%)', borderRadius: 14, overflow: 'visible' }}
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
                style={{
                  position: 'absolute',
                  left: `clamp(12px, calc(${((hoveredPoint.x / 520) * 100).toFixed(2)}% - 70px), calc(100% - 180px))`,
                  top: 22,
                  minWidth: 170,
                  pointerEvents: 'none',
                  padding: '10px 12px',
                  borderRadius: 12,
                  background: 'rgba(15,23,42,0.94)',
                  color: '#f8fafc',
                  boxShadow: '0 12px 28px rgba(15,23,42,0.28)',
                  border: '1px solid rgba(148,163,184,0.22)',
                  fontSize: 12,
                  lineHeight: 1.55,
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 6 }}>{formatDateTime(hoveredPoint.item.created_at)}</div>
                <div>权益：{formatMoney(hoveredPoint.item.equity)}</div>
                <div>已实现盈亏：{formatMoney(hoveredPoint.item.realized_pnl)}</div>
                <div>未实现盈亏：{formatMoney(hoveredPoint.item.unrealized_pnl)}</div>
                <div>占用保证金：{formatMoney(hoveredPoint.item.margin_used)}</div>
              </div>
            ) : null}
          </div>
          <div style={{ ...metricGridStyle, marginTop: 12 }}>
            <MetricTile label="起点权益" value={formatMoney(equityCurve[0]?.equity)} />
            <MetricTile label="终点权益" value={formatMoney(equityCurve[equityCurve.length - 1]?.equity)} />
            <MetricTile label="采样点数" value={equityCurve.length} />
          </div>
        </>
      )}
    </div>
  )
}
