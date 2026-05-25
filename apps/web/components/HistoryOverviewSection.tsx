import type { HistoryStats } from './dashboard-types'
import { chipStyle, labelStyle, metricCardStyle, metricSubtleRowStyle, metricValueLgStyle, sectionHintStyle, sectionTitleStyle } from './dashboard-types'
import { formatMoney } from './dashboard-utils'

function MetricCard({ label, value, positive, footnote, chip }: { label: string; value: string; positive?: boolean; footnote?: string; chip?: string }) {
  const tone = positive === undefined ? '#0f172a' : positive ? '#166534' : '#dc2626'
  return (
    <div style={metricCardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
        <div style={labelStyle}>{label}</div>
        {chip ? <span style={chipStyle({ color: '#7c3aed', background: 'rgba(124,58,237,0.12)' })}>{chip}</span> : null}
      </div>
      <div style={{ ...metricValueLgStyle, color: tone }}>{value}</div>
      <div style={metricSubtleRowStyle}>
        <span>{footnote || '用于复盘策略历史表现'}</span>
      </div>
    </div>
  )
}

export default function HistoryOverviewSection({ historyStats }: { historyStats: HistoryStats | null }) {
  return (
    <section style={{ marginBottom: 20 }}>
      <div style={{ marginBottom: 14 }}>
        <h2 style={sectionTitleStyle}>历史表现概览</h2>
        <p style={sectionHintStyle}>先看交易结果和回撤，再决定策略参数要不要继续调。</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 16 }}>
        <MetricCard label="总交易次数" value={String(historyStats?.total_trades ?? 0)} chip="Trades" footnote={`胜 ${historyStats?.win_trades ?? 0} / 负 ${historyStats?.loss_trades ?? 0}`} />
        <MetricCard label="胜率" value={`${((historyStats?.win_rate ?? 0) * 100).toFixed(2)}%`} positive={(historyStats?.win_rate ?? 0) >= 0.5} footnote="高于 50% 不代表一定赚钱" />
        <MetricCard label="总已实现收益" value={formatMoney(historyStats?.total_realized_pnl)} positive={(historyStats?.total_realized_pnl ?? 0) >= 0} footnote={`毛收益 ${formatMoney(historyStats?.total_gross_realized_pnl)}`} />
        <MetricCard label="单笔平均收益" value={formatMoney(historyStats?.avg_pnl_per_trade)} positive={(historyStats?.avg_pnl_per_trade ?? 0) >= 0} footnote={`平均手续费 ${formatMoney(historyStats?.avg_fee_per_trade)}`} />
        <MetricCard label="最大回撤" value={`${((historyStats?.max_drawdown_ratio ?? 0) * 100).toFixed(2)}%`} positive={(historyStats?.max_drawdown_ratio ?? 0) <= 0.1} footnote={`平均滑点 ${formatMoney(historyStats?.avg_slippage_cost_per_trade)}`} />
      </div>
    </section>
  )
}
