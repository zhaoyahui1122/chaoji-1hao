import type { DashboardData } from './dashboard-types'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatMoney } from './dashboard-utils'

function MetricCard({ label, value, positive, footnote, chip }: { label: string; value: string; positive?: boolean; footnote?: string; chip?: string }) {
  const tone = positive === undefined ? 'text-text-primary' : positive ? 'text-accent-green' : 'text-accent-red'
  return (
    <Card className="bg-bg-card border-border shadow-[inset_0_0_0_1px_rgba(255,255,255,0.02),0_18px_36px_rgba(2,8,23,0.28)]">
      <CardContent className="p-4 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2.5">
          <span className="text-xs font-medium tracking-wide text-text-secondary uppercase">{label}</span>
          {chip ? <Badge variant="outline" className="border-accent-cyan/30 bg-accent-cyan/10 text-accent-cyan text-[10px] px-1.5 py-0">{chip}</Badge> : null}
        </div>
        <div className={`text-xl font-bold tabular-nums ${tone}`}>{value}</div>
        <div className="text-xs text-text-muted">
          <span>{footnote || '实时同步账户快照'}</span>
        </div>
      </CardContent>
    </Card>
  )
}

export default function AccountOverviewSection({ account }: { account: DashboardData['account'] }) {
  return (
    <section className="mb-5">
      <div className="mb-3.5">
        <h2 className="text-lg font-semibold text-text-primary">账户总览</h2>
        <p className="text-sm text-text-secondary mt-1">把权益、保证金、敞口和盈亏压缩进一组总览指标，先看账户安全边界，再看交易动作。</p>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-4">
        <MetricCard label="账户权益" value={formatMoney(account.equity)} chip="Equity" />
        <MetricCard label="可用余额" value={formatMoney(account.available_balance)} chip="Balance" />
        <MetricCard label="保证金占用" value={formatMoney(account.margin_used)} footnote={`占用率 ${(account.margin_ratio * 100).toFixed(2)}%`} />
        <MetricCard label="未实现盈亏" value={formatMoney(account.unrealized_pnl)} positive={account.unrealized_pnl >= 0} footnote="浮动收益随标记价变化" />
      </div>

      <div className="grid grid-cols-4 gap-4">
        <MetricCard label="保证金率" value={`${(account.margin_ratio * 100).toFixed(2)}%`} positive={account.margin_ratio < 1} footnote="低于 100% 更安全" />
        <MetricCard label="持仓数量" value={String(account.open_positions)} footnote="当前未平仓仓位数" />
        <MetricCard label="已实现盈亏" value={formatMoney(account.realized_pnl)} positive={account.realized_pnl >= 0} footnote="历史平仓后的累计结果" />
        <MetricCard label="账户状态" value={account.margin_ratio >= 1 ? '高风险' : '正常'} positive={account.margin_ratio < 1} footnote={account.margin_ratio >= 1 ? '建议立刻降杠杆或减仓' : '当前风险可控'} />
      </div>
    </section>
  )
}
