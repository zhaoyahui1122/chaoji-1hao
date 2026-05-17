import type React from 'react'

import type { HistoryPosition } from './dashboard-types'
import { cardStyle } from './dashboard-types'
import { formatDateTime, formatMoney, formatPercent, parseMetaJson, readPositionTargetPrice } from './dashboard-utils'

const mutedText: React.CSSProperties = {
  color: '#64748b',
  fontSize: 12,
}

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 20,
  fontWeight: 800,
  letterSpacing: '-0.02em',
  color: '#0f172a',
}

const shellCard: React.CSSProperties = {
  border: '1px solid rgba(148, 163, 184, 0.18)',
  borderRadius: 18,
  background: 'linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(248,250,252,0.98) 100%)',
  boxShadow: '0 12px 28px rgba(15, 23, 42, 0.06)',
  padding: 14,
  minWidth: 0,
}

const chipBase: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  borderRadius: 999,
  padding: '4px 10px',
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '0.01em',
}

function buildChipStyle(colors: { color: string; background: string }): React.CSSProperties {
  return {
    ...chipBase,
    color: colors.color,
    background: colors.background,
  }
}

function sideColor(side?: string) {
  return String(side || '').toLowerCase() === 'long'
    ? { color: '#1d4ed8', background: 'rgba(59,130,246,0.15)' }
    : { color: '#7c3aed', background: 'rgba(124,58,237,0.12)' }
}

function SummaryMetric({ label, value, valueStyle }: { label: string; value: React.ReactNode; valueStyle?: React.CSSProperties }) {
  return (
    <div style={{ padding: 12, borderRadius: 14, background: 'rgba(248,250,252,0.92)', border: '1px solid rgba(226,232,240,0.9)' }}>
      <div style={mutedText}>{label}</div>
      <div style={{ marginTop: 6, fontSize: 14, fontWeight: 700, color: '#0f172a', wordBreak: 'break-word', ...valueStyle }}>{value}</div>
    </div>
  )
}

function pnlRateLabel(label: string, value?: number | null) {
  if (value == null) return label
  if (value < 0) return label.replace('收益率', '亏损率')
  return label
}

function pnlRateValue(rate?: number | null) {
  if (rate == null) return '-'
  return `${rate >= 0 ? '+' : ''}${formatPercent(rate)}`
}

function deriveRates(position: HistoryPosition) {
  const marginRate = position.pnl_rate_on_margin
  const notionalRate = position.pnl_rate_on_notional
  if (marginRate != null || notionalRate != null) {
    return { marginRate, notionalRate }
  }

  const meta = parseMetaJson(position.open_meta_json)
  const entryPrice = Number(position.entry_price ?? 0)
  const qty = Number(position.qty ?? 0)
  const leverage = Number(position.leverage ?? 0)
  const realizedPnl = position.realized_pnl == null ? null : Number(position.realized_pnl)
  if (realizedPnl == null) {
    return { marginRate: null, notionalRate: null }
  }

  const entryNotional = entryPrice * qty
  const metaEffectiveMargin = Number(meta?.effective_allocated_margin ?? 0)
  const metaAllocatedMargin = Number(meta?.allocated_margin ?? 0)
  const fallbackMargin = leverage > 0 ? entryNotional / leverage : entryNotional
  const marginBasis = metaEffectiveMargin > 0 ? metaEffectiveMargin : metaAllocatedMargin > 0 ? metaAllocatedMargin : fallbackMargin

  return {
    marginRate: marginBasis > 0 ? realizedPnl / marginBasis : null,
    notionalRate: entryNotional > 0 ? realizedPnl / entryNotional : null,
  }
}

function formatTargetPrice(value: number | null) {
  return value == null ? '-' : Number(value).toFixed(2)
}

export default function PositionHistoryCard({
  positionHistory,
}: {
  positionHistory: HistoryPosition[]
}) {
  return (
    <div style={cardStyle}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={titleStyle}>历史持仓</h2>
        <div style={{ ...mutedText, marginTop: 6 }}>这里只看最关键的结果：开仓价、平仓价、净盈亏，以及按保证金和名义价值计算的净收益率（已计入买入和卖出手续费）。</div>
      </div>

      {positionHistory.length === 0 ? (
        <div style={{ ...shellCard, color: '#64748b' }}>暂无历史持仓</div>
      ) : (
        <div style={{ display: 'grid', gap: 12, maxHeight: 420, overflow: 'auto', paddingRight: 4 }}>
          {positionHistory.map((position) => {
            const positionSide = sideColor(position.side)
            const realizedPnl = Number(position.realized_pnl ?? 0)
            const pnlColor = realizedPnl > 0 ? '#166534' : realizedPnl < 0 ? '#b91c1c' : '#475569'
            const { marginRate, notionalRate } = deriveRates(position)
            const stopLossPrice = readPositionTargetPrice(position.open_meta_json, 'stop_loss_price')
            const takeProfitPrice = readPositionTargetPrice(position.open_meta_json, 'take_profit_price')

            return (
              <div key={position.id} style={shellCard}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 15, color: '#0f172a' }}>{position.symbol}</strong>
                    <span style={buildChipStyle(positionSide)}>{position.side}</span>
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: pnlColor }}>
                    {position.realized_pnl == null ? '-' : formatMoney(position.realized_pnl)}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginTop: 12 }}>
                  <SummaryMetric label="开仓时间" value={formatDateTime(position.opened_at)} />
                  <SummaryMetric label="平仓时间" value={formatDateTime(position.closed_at)} />
                  <SummaryMetric label="开仓价" value={Number(position.entry_price ?? 0).toFixed(2)} />
                  <SummaryMetric label="止损价" value={formatTargetPrice(stopLossPrice)} />
                  <SummaryMetric label="止盈价" value={formatTargetPrice(takeProfitPrice)} />
                  <SummaryMetric label="平仓价" value={position.close_price == null ? '-' : Number(position.close_price).toFixed(2)} />
                  <SummaryMetric label="盈利" value={position.realized_pnl == null ? '-' : formatMoney(position.realized_pnl)} valueStyle={{ color: pnlColor }} />
                  <SummaryMetric label={pnlRateLabel('保证金收益率', marginRate)} value={pnlRateValue(marginRate)} valueStyle={{ color: pnlColor }} />
                  <SummaryMetric label={pnlRateLabel('名义价值收益率', notionalRate)} value={pnlRateValue(notionalRate)} valueStyle={{ color: pnlColor }} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
