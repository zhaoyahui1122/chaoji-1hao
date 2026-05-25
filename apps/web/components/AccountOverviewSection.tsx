import type { DashboardData } from './dashboard-types'
import { chipStyle, labelStyle, metricCardStyle, metricSubtleRowStyle, metricValueLgStyle, sectionHintStyle, sectionTitleStyle } from './dashboard-types'
import { formatMoney } from './dashboard-utils'

function MetricCard({ label, value, positive, footnote, chip }: { label: string; value: string; positive?: boolean; footnote?: string; chip?: string }) {
  const tone = positive === undefined ? '#f8fafc' : positive ? '#86efac' : '#fca5a5'
  return (
    <div
      style={{
        ...metricCardStyle,
        background: 'linear-gradient(180deg, rgba(15,23,42,0.94) 0%, rgba(2,6,23,0.96) 100%)',
        border: '1px solid rgba(51,65,85,0.72)',
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.02), 0 18px 36px rgba(2,8,23,0.28)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
        <div style={{ ...labelStyle, color: '#94a3b8' }}>{label}</div>
        {chip ? <span style={chipStyle({ color: '#bae6fd', background: 'rgba(14,165,233,0.14)' })}>{chip}</span> : null}
      </div>
      <div style={{ ...metricValueLgStyle, color: tone }}>{value}</div>
      <div style={{ ...metricSubtleRowStyle, color: '#64748b' }}>
        <span>{footnote || '实时同步账户快照'}</span>
      </div>
    </div>
  )
}

export default function AccountOverviewSection({ account }: { account: DashboardData['account'] }) {
  return (
    <section style={{ marginBottom: 20 }}>
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ ...sectionTitleStyle, color: '#f8fafc' }}>账户总览</h2>
        <p style={{ ...sectionHintStyle, color: '#94a3b8' }}>把权益、保证金、敞口和盈亏压缩进一组总览指标，先看账户安全边界，再看交易动作。</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 16, marginBottom: 16 }}>
        <MetricCard label="账户权益" value={formatMoney(account.equity)} chip="Equity" />
        <MetricCard label="可用余额" value={formatMoney(account.available_balance)} chip="Balance" />
        <MetricCard label="保证金占用" value={formatMoney(account.margin_used)} footnote={`占用率 ${(account.margin_ratio * 100).toFixed(2)}%`} />
        <MetricCard label="未实现盈亏" value={formatMoney(account.unrealized_pnl)} positive={account.unrealized_pnl >= 0} footnote="浮动收益随标记价变化" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 16 }}>
        <MetricCard label="保证金率" value={`${(account.margin_ratio * 100).toFixed(2)}%`} positive={account.margin_ratio < 1} footnote="低于 100% 更安全" />
        <MetricCard label="持仓数量" value={String(account.open_positions)} footnote="当前未平仓仓位数" />
        <MetricCard label="已实现盈亏" value={formatMoney(account.realized_pnl)} positive={account.realized_pnl >= 0} footnote="历史平仓后的累计结果" />
        <MetricCard label="账户状态" value={account.margin_ratio >= 1 ? '高风险' : '正常'} positive={account.margin_ratio < 1} footnote={account.margin_ratio >= 1 ? '建议立刻降杠杆或减仓' : '当前风险可控'} />
      </div>
    </section>
  )
}
