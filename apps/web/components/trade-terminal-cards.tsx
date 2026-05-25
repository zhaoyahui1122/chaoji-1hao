import type React from 'react'

import type { HistoryFilters, HistoryOrder, RunnerLogItem } from './dashboard-types'
import { cardStyle } from './dashboard-types'
import {
  formatDateTime,
  formatMarketDataStatus,
  formatMoney,
  getRunnerEvent,
  getRunnerPayload,
  marketDataStatusColor,
  renderOrderMetaSummary,
  renderRunnerEventSummary,
  renderRunnerExecutionSummary,
} from './dashboard-utils'

const mutedText: React.CSSProperties = {
  color: '#64748b',
  fontSize: 12,
}

const sectionTitle: React.CSSProperties = {
  margin: 0,
  fontSize: 20,
  fontWeight: 800,
  letterSpacing: '-0.02em',
  color: '#0f172a',
}

const timelineWrap: React.CSSProperties = {
  display: 'grid',
  gap: 12,
  maxHeight: 420,
  overflow: 'auto',
  paddingRight: 4,
}

const timelineItem: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '140px 12px minmax(0, 1fr)',
  gap: 12,
  alignItems: 'stretch',
}

const bulletColumn: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
}

const bulletLine: React.CSSProperties = {
  width: 2,
  background: 'linear-gradient(180deg, rgba(37,99,235,0.28) 0%, rgba(148,163,184,0.08) 100%)',
  position: 'relative',
  borderRadius: 999,
}

const bulletDot: React.CSSProperties = {
  position: 'absolute',
  top: 10,
  left: '50%',
  width: 10,
  height: 10,
  borderRadius: 999,
  transform: 'translateX(-50%)',
  background: '#2563eb',
  boxShadow: '0 0 0 4px rgba(37,99,235,0.14)',
}

const shellCard: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.18)',
  borderRadius: 18,
  background: 'linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(248,250,252,0.98) 100%)',
  boxShadow: '0 12px 28px rgba(15, 23, 42, 0.06)',
  padding: 14,
  minWidth: 0,
}

const compactStatGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
  gap: 10,
}

const compactMetricCard: React.CSSProperties = {
  padding: 12,
  borderRadius: 14,
  background: 'rgba(248,250,252,0.92)',
  border: '1px solid rgba(226,232,240,0.9)',
}

const statChipBase: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  borderRadius: 999,
  padding: '4px 10px',
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '0.01em',
}

function orderEventColor(eventType?: string) {
  switch (eventType) {
    case 'open':
      return { color: '#166534', background: 'rgba(34,197,94,0.14)' }
    case 'close':
      return { color: '#b45309', background: 'rgba(245,158,11,0.16)' }
    case 'mark':
      return { color: '#1d4ed8', background: 'rgba(59,130,246,0.15)' }
    default:
      return { color: '#475569', background: 'rgba(148,163,184,0.18)' }
  }
}

function statusColor(status?: string) {
  const normalized = String(status || '').toLowerCase()
  if (normalized.includes('filled') || normalized.includes('closed') || normalized.includes('done')) {
    return { color: '#166534', background: 'rgba(34,197,94,0.14)' }
  }
  if (normalized.includes('cancel') || normalized.includes('reject') || normalized.includes('fail')) {
    return { color: '#b91c1c', background: 'rgba(239,68,68,0.14)' }
  }
  if (normalized.includes('open') || normalized.includes('running')) {
    return { color: '#1d4ed8', background: 'rgba(59,130,246,0.14)' }
  }
  return { color: '#475569', background: 'rgba(148,163,184,0.18)' }
}

function actionColor(action?: string | null) {
  const normalized = String(action || '').toLowerCase()
  if (normalized.includes('open') || normalized.includes('buy') || normalized.includes('long')) {
    return { color: '#166534', background: 'rgba(34,197,94,0.14)' }
  }
  if (normalized.includes('close') || normalized.includes('sell') || normalized.includes('exit')) {
    return { color: '#b45309', background: 'rgba(245,158,11,0.16)' }
  }
  if (normalized.includes('skip') || normalized.includes('wait') || normalized.includes('hold')) {
    return { color: '#475569', background: 'rgba(148,163,184,0.18)' }
  }
  return { color: '#1d4ed8', background: 'rgba(59,130,246,0.14)' }
}

function buildChipStyle(colors: { color: string; background: string }): React.CSSProperties {
  return {
    ...statChipBase,
    color: colors.color,
    background: colors.background,
  }
}

function MetricCell({ label, value, valueStyle }: { label: string; value: React.ReactNode; valueStyle?: React.CSSProperties }) {
  return (
    <div style={compactMetricCard}>
      <div style={mutedText}>{label}</div>
      <div style={{ marginTop: 6, fontSize: 14, fontWeight: 700, color: '#0f172a', wordBreak: 'break-word', ...valueStyle }}>{value}</div>
    </div>
  )
}

function buildOrderReplay(order: HistoryOrder) {
  const eventLabel = order.event_type || 'open'
  const sourceLabel = order.source || 'manual'
  const priceLabel = Number(order.price ?? 0).toFixed(2)
  const qtyLabel = Number(order.qty ?? 0).toFixed(6)
  return `${eventLabel.toUpperCase()} · ${order.symbol} ${order.side} @ ${priceLabel} / 数量 ${qtyLabel} / 来源 ${sourceLabel}`
}

export function OrderHistoryCard({
  orderHistory,
  historyFilters,
}: {
  orderHistory: HistoryOrder[]
  historyFilters: HistoryFilters
}) {
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <h2 style={sectionTitle}>历史订单</h2>
          <div style={{ ...mutedText, marginTop: 6 }}>按时间线查看开仓、盯市、平仓事件，方便复盘每一笔动作。</div>
        </div>
        <div data-testid="order-history-filter-chips" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <span style={buildChipStyle({ color: '#334155', background: 'rgba(148,163,184,0.14)' })}>{historyFilters.symbol || '全部交易对'}</span>
          <span style={buildChipStyle({ color: '#334155', background: 'rgba(148,163,184,0.14)' })}>{historyFilters.status || '全部状态'}</span>
          <span style={buildChipStyle({ color: '#334155', background: 'rgba(148,163,184,0.14)' })}>{historyFilters.event_type || '全部事件'}</span>
          <span style={buildChipStyle({ color: '#334155', background: 'rgba(148,163,184,0.14)' })}>{historyFilters.source || '全部来源'}</span>
        </div>
      </div>
      {orderHistory.length === 0 ? (
        <div style={{ ...shellCard, color: '#64748b' }}>暂无历史订单</div>
      ) : (
        <>
          <div style={{ ...shellCard, marginBottom: 14, background: 'linear-gradient(180deg, rgba(248,250,252,0.98) 0%, rgba(241,245,249,0.98) 100%)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>最近订单回放</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', marginTop: 6 }}>{buildOrderReplay(orderHistory[0])}</div>
              </div>
              <div style={{ ...mutedText, fontWeight: 600 }}>{formatDateTime(orderHistory[0]?.created_at)}</div>
            </div>
            <div style={{ ...compactStatGrid, marginTop: 12 }}>
              <MetricCell label="事件" value={orderHistory[0]?.event_type || '-'} valueStyle={orderEventColor(orderHistory[0]?.event_type)} />
              <MetricCell label="状态" value={orderHistory[0]?.status || '-'} valueStyle={statusColor(orderHistory[0]?.status)} />
              <MetricCell label="价格" value={Number(orderHistory[0]?.price ?? 0).toFixed(2)} />
              <MetricCell label="数量" value={Number(orderHistory[0]?.qty ?? 0).toFixed(6)} />
              <MetricCell label="仓位 ID" value={orderHistory[0]?.position_id || '-'} valueStyle={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13 }} />
            </div>
            <div style={{ marginTop: 12, padding: 12, borderRadius: 14, background: 'rgba(255,255,255,0.78)', color: '#334155', fontSize: 13, lineHeight: 1.65 }}>
              <strong>执行摘要：</strong>{renderOrderMetaSummary(orderHistory[0])}
            </div>
          </div>
          <div style={timelineWrap}>
            {orderHistory.map((order) => {
              const eventColors = orderEventColor(order.event_type)
              const orderStatusColors = statusColor(order.status)
              return (
                <div key={order.id} style={timelineItem}>
                  <div style={{ ...mutedText, fontSize: 12, paddingTop: 8 }}>{formatDateTime(order.created_at)}</div>
                  <div style={bulletColumn} aria-hidden>
                    <div style={bulletLine}>
                      <div style={{ ...bulletDot, background: eventColors.color, boxShadow: `0 0 0 4px ${eventColors.background}` }} />
                    </div>
                  </div>
                  <div style={shellCard}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                        <strong style={{ fontSize: 15, color: '#0f172a' }}>{order.symbol}</strong>
                        <span style={buildChipStyle(eventColors)}>{order.event_type || 'open'}</span>
                        <span style={buildChipStyle(orderStatusColors)}>{order.status}</span>
                        <span style={buildChipStyle({ color: '#7c3aed', background: 'rgba(124,58,237,0.12)' })}>{order.side}</span>
                      </div>
                      <div style={{ ...mutedText, fontWeight: 600 }}>来源：{order.source || 'manual'}</div>
                    </div>
                    <div style={{ ...compactStatGrid, marginTop: 12 }}>
                      <MetricCell label="价格" value={Number(order.price ?? 0).toFixed(2)} />
                      <MetricCell label="数量" value={Number(order.qty ?? 0).toFixed(6)} />
                      <MetricCell label="仓位 ID" value={order.position_id || '-'} valueStyle={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13 }} />
                    </div>
                    <div style={{ marginTop: 12, padding: 12, borderRadius: 14, background: 'rgba(241,245,249,0.78)', color: '#334155', fontSize: 13, lineHeight: 1.6 }}>
                      {renderOrderMetaSummary(order)}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

export function RunnerLogsCard({ runnerLogs }: { runnerLogs: RunnerLogItem[] }) {
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <h2 style={sectionTitle}>最近策略执行</h2>
          <div style={{ ...mutedText, marginTop: 6 }}>按执行时间倒序查看动作、信号、数据源状态与事件落地结果。</div>
        </div>
        <span style={buildChipStyle({ color: '#0f172a', background: 'rgba(15,23,42,0.08)' })}>{runnerLogs?.length || 0} 条记录</span>
      </div>
      {!runnerLogs || runnerLogs.length === 0 ? (
        <div style={{ ...shellCard, color: '#64748b' }}>暂无执行日志</div>
      ) : (
        <>
          {(() => {
            const latest = runnerLogs[runnerLogs.length - 1]
            const latestPayload = getRunnerPayload(latest?.result)
            const latestEvent = getRunnerEvent(latest?.result)
            return (
              <div style={{ ...shellCard, marginBottom: 14, background: 'linear-gradient(180deg, rgba(239,246,255,0.98) 0%, rgba(248,250,252,0.98) 100%)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>最近一次决策解释</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', marginTop: 6 }}>{latestPayload?.action || latestPayload?.reason || 'unknown'}</div>
                  </div>
                  <div style={{ ...mutedText, fontWeight: 600 }}>{formatDateTime(latest?.ts)}</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginTop: 12 }}>
                  <div><div style={mutedText}>信号</div><div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>{String(latestPayload?.signal ?? '-')}</div></div>
                  <div><div style={mutedText}>价格</div><div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>{latestPayload?.price !== undefined && latestPayload?.price !== null ? Number(latestPayload.price).toFixed(2) : '-'}</div></div>
                  <div><div style={mutedText}>数据源</div><div style={{ fontSize: 15, fontWeight: 700, color: marketDataStatusColor(latestPayload?.market_data) }}>{formatMarketDataStatus(latestPayload?.market_data)}</div></div>
                  <div><div style={mutedText}>事件</div><div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>{latestEvent?.event_type || '-'}</div></div>
                </div>
                <div style={{ marginTop: 12, padding: 12, borderRadius: 14, background: 'rgba(255,255,255,0.78)', color: '#334155', fontSize: 13, lineHeight: 1.65 }}>
                  <div><strong>执行摘要：</strong>{renderRunnerExecutionSummary(latest?.result)}</div>
                  <div style={{ marginTop: 8 }}><strong>事件详情：</strong>{latestEvent ? renderRunnerEventSummary(latest?.result) : '暂无事件写入'}</div>
                </div>
              </div>
            )
          })()}
          <div style={timelineWrap}>
            {runnerLogs.slice().reverse().map((item: RunnerLogItem, idx: number) => {
              const runnerPayload = getRunnerPayload(item.result)
              const runnerEvent = getRunnerEvent(item.result)
              const actionColors = actionColor(runnerPayload?.action || runnerPayload?.reason || 'unknown')
              return (
                <div key={`${item.ts}-${idx}`} style={timelineItem}>
                  <div style={{ ...mutedText, fontSize: 12, paddingTop: 8 }}>{formatDateTime(item.ts)}</div>
                  <div style={bulletColumn} aria-hidden>
                    <div style={bulletLine}>
                      <div style={{ ...bulletDot, background: actionColors.color, boxShadow: `0 0 0 4px ${actionColors.background}` }} />
                    </div>
                  </div>
                  <div style={shellCard}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                        <strong style={{ fontSize: 15, color: '#0f172a' }}>{runnerPayload?.action || runnerPayload?.reason || 'unknown'}</strong>
                        <span style={buildChipStyle(actionColors)}>{item.config?.symbol || '-'}</span>
                        <span style={buildChipStyle({ color: '#334155', background: 'rgba(148,163,184,0.18)' })}>{item.config?.timeframe || '-'}</span>
                        <span style={buildChipStyle({ color: '#1d4ed8', background: 'rgba(59,130,246,0.14)' })}>
                          {item.config?.strategy_type || '-'}
                        </span>
                        {runnerEvent?.event_type ? <span style={buildChipStyle(orderEventColor(runnerEvent.event_type))}>{runnerEvent.event_type}</span> : null}
                      </div>
                      <div style={{ ...mutedText, fontWeight: 600 }}>
                        数据源：
                        <span style={{ color: marketDataStatusColor(runnerPayload?.market_data), fontWeight: 800 }}>
                          {formatMarketDataStatus(runnerPayload?.market_data)}
                        </span>
                      </div>
                    </div>

                    <div style={{ ...compactStatGrid, marginTop: 12 }}>
                      <MetricCell label="信号" value={String(runnerPayload?.signal ?? '-')} />
                      <MetricCell label="价格" value={runnerPayload?.price !== undefined && runnerPayload?.price !== null ? Number(runnerPayload.price).toFixed(2) : '-'} />
                      <MetricCell label="来源" value={runnerEvent?.source || '-'} />
                      <MetricCell label="仓位 ID" value={runnerEvent?.position_id || '-'} valueStyle={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13 }} />
                    </div>

                    <div style={{ marginTop: 12, padding: 12, borderRadius: 14, background: 'rgba(241,245,249,0.78)', color: '#334155', fontSize: 13, lineHeight: 1.6 }}>
                      <div><strong>执行摘要：</strong>{renderRunnerExecutionSummary(item.result)}</div>
                      {runnerEvent ? <div style={{ marginTop: 8 }}><strong>事件详情：</strong>{renderRunnerEventSummary(item.result)}</div> : null}
                      {runnerPayload?.market_data?.warning ? (
                        <div style={{ marginTop: 8, color: '#b45309' }}><strong>警告：</strong>{runnerPayload.market_data.warning}</div>
                      ) : null}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
