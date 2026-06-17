import type { HistoryStats } from './dashboard-types'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatMoney } from './dashboard-utils'

function MetricCard({ label, value, positive, footnote, chip }: { label: string; value: string; positive?: boolean; footnote?: string; chip?: string }) {
  const tone = positive === undefined ? 'text-text-primary' : positive ? 'text-accent-green' : 'text-accent-red'
  return (
    <Card className="bg-bg-card border-border">
      <CardContent className="p-4 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2.5">
          <span className="text-xs font-medium tracking-wide text-text-secondary uppercase">{label}</span>
          {chip ? <Badge variant="outline" className="border-accent-blue/30 bg-accent-blue/10 text-accent-blue text-[10px] px-1.5 py-0">{chip}</Badge> : null}
        </div>
        <div className={`text-xl font-bold tabular-nums ${tone}`}>{value}</div>
        <div className="text-xs text-text-muted">
          <span>{footnote || '用于复盘策略历史表现'}</span>
        </div>
      </CardContent>
    </Card>
  )
}

export default function HistoryOverviewSection({ historyStats }: { historyStats: HistoryStats | null }) {
  return (
    <section className="mb-5">
      <div className="mb-3.5">
        <h2 className="text-lg font-semibold text-text-primary">历史表现概览</h2>
        <p className="text-sm text-text-secondary mt-1">先看交易结果和回撤，再决定策略参数要不要继续调。</p>
      </div>

      <div className="grid grid-cols-5 gap-4">
        <MetricCard label="总交易次数" value={String(historyStats?.total_trades ?? 0)} chip="Trades" footnote={`胜 ${historyStats?.win_trades ?? 0} / 负 ${historyStats?.loss_trades ?? 0}`} />
        <MetricCard label="胜率" value={`${((historyStats?.win_rate ?? 0) * 100).toFixed(2)}%`} positive={(historyStats?.win_rate ?? 0) >= 0.5} footnote="高于 50% 不代表一定赚钱" />
        <MetricCard label="总已实现收益" value={formatMoney(historyStats?.total_realized_pnl)} positive={(historyStats?.total_realized_pnl ?? 0) >= 0} footnote={`毛收益 ${formatMoney(historyStats?.total_gross_realized_pnl)}`} />
        <MetricCard label="单笔平均收益" value={formatMoney(historyStats?.avg_pnl_per_trade)} positive={(historyStats?.avg_pnl_per_trade ?? 0) >= 0} footnote={`平均手续费 ${formatMoney(historyStats?.avg_fee_per_trade)}`} />
        <MetricCard label="最大回撤" value={`${((historyStats?.max_drawdown_ratio ?? 0) * 100).toFixed(2)}%`} positive={(historyStats?.max_drawdown_ratio ?? 0) <= 0.1} footnote={`平均滑点 ${formatMoney(historyStats?.avg_slippage_cost_per_trade)}`} />
      </div>
    </section>
  )
}
