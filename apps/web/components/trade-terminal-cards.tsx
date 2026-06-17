import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'

import type { HistoryFilters, HistoryOrder, RunnerLogItem } from './dashboard-types'
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

function orderEventColor(eventType?: string): string {
  switch (eventType) {
    case 'open':
      return 'bg-green-500/14 text-green-400'
    case 'close':
      return 'bg-amber-500/16 text-amber-400'
    case 'mark':
      return 'bg-blue-500/15 text-blue-400'
    default:
      return 'bg-slate-500/18 text-slate-400'
  }
}

function orderEventDotColor(eventType?: string): string {
  switch (eventType) {
    case 'open':
      return 'bg-green-400 shadow-[0_0_0_4px_rgba(34,197,94,0.14)]'
    case 'close':
      return 'bg-amber-400 shadow-[0_0_0_4px_rgba(245,158,11,0.16)]'
    case 'mark':
      return 'bg-blue-400 shadow-[0_0_0_4px_rgba(59,130,246,0.15)]'
    default:
      return 'bg-slate-400 shadow-[0_0_0_4px_rgba(148,163,184,0.18)]'
  }
}

function statusColor(status?: string): string {
  const normalized = String(status || '').toLowerCase()
  if (normalized.includes('filled') || normalized.includes('closed') || normalized.includes('done')) {
    return 'bg-green-500/14 text-green-400'
  }
  if (normalized.includes('cancel') || normalized.includes('reject') || normalized.includes('fail')) {
    return 'bg-red-500/14 text-red-400'
  }
  if (normalized.includes('open') || normalized.includes('running')) {
    return 'bg-blue-500/14 text-blue-400'
  }
  return 'bg-slate-500/18 text-slate-400'
}

function actionColor(action?: string | null): string {
  const normalized = String(action || '').toLowerCase()
  if (normalized.includes('open') || normalized.includes('buy') || normalized.includes('long')) {
    return 'bg-green-500/14 text-green-400'
  }
  if (normalized.includes('close') || normalized.includes('sell') || normalized.includes('exit')) {
    return 'bg-amber-500/16 text-amber-400'
  }
  if (normalized.includes('skip') || normalized.includes('wait') || normalized.includes('hold')) {
    return 'bg-slate-500/18 text-slate-400'
  }
  return 'bg-blue-500/14 text-blue-400'
}

function actionDotColor(action?: string | null): string {
  const normalized = String(action || '').toLowerCase()
  if (normalized.includes('open') || normalized.includes('buy') || normalized.includes('long')) {
    return 'bg-green-400 shadow-[0_0_0_4px_rgba(34,197,94,0.14)]'
  }
  if (normalized.includes('close') || normalized.includes('sell') || normalized.includes('exit')) {
    return 'bg-amber-400 shadow-[0_0_0_4px_rgba(245,158,11,0.16)]'
  }
  if (normalized.includes('skip') || normalized.includes('wait') || normalized.includes('hold')) {
    return 'bg-slate-400 shadow-[0_0_0_4px_rgba(148,163,184,0.18)]'
  }
  return 'bg-blue-400 shadow-[0_0_0_4px_rgba(59,130,246,0.14)]'
}

function MetricCell({ label, value, valueClassName }: { label: string; value: React.ReactNode; valueClassName?: string }) {
  return (
    <div className="rounded-[14px] border border-border/60 bg-bg-card/80 p-3">
      <div className="text-xs text-text-muted">{label}</div>
      <div className={`mt-1.5 text-sm font-bold break-words text-text-primary ${valueClassName ?? ''}`}>{value}</div>
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

function marketDataColorClass(meta?: Record<string, unknown> | null): string {
  const color = marketDataStatusColor(meta as any)
  // Map hex colors returned by marketDataStatusColor to Tailwind classes
  if (color === '#16a34a') return 'text-accent-green'
  if (color === '#d97706' || color === '#ea580c') return 'text-amber-400'
  if (color === '#2563eb') return 'text-accent-cyan'
  return 'text-text-muted'
}

export function OrderHistoryCard({
  orderHistory,
  historyFilters,
}: {
  orderHistory: HistoryOrder[]
  historyFilters: HistoryFilters
}) {
  return (
    <div className="rounded-3xl border border-white/[0.08] bg-gradient-to-b from-[rgba(16,18,24,0.96)] to-[rgba(11,13,18,0.98)] p-5 shadow-[0_22px_44px_rgba(0,0,0,0.22)] backdrop-blur-[10px]">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold tracking-tight text-text-primary">历史订单</h2>
          <div className="mt-1.5 text-xs text-text-muted">按时间线查看开仓、盯市、平仓事件，方便复盘每一笔动作。</div>
        </div>
        <div data-testid="order-history-filter-chips" className="flex flex-wrap justify-end gap-2">
          <Badge className="bg-slate-500/14 text-slate-300">{historyFilters.symbol || '全部交易对'}</Badge>
          <Badge className="bg-slate-500/14 text-slate-300">{historyFilters.status || '全部状态'}</Badge>
          <Badge className="bg-slate-500/14 text-slate-300">{historyFilters.event_type || '全部事件'}</Badge>
          <Badge className="bg-slate-500/14 text-slate-300">{historyFilters.source || '全部来源'}</Badge>
        </div>
      </div>
      {orderHistory.length === 0 ? (
        <div className="rounded-[18px] border border-border/18 bg-gradient-to-b from-white/[0.02] to-white/[0.01] p-3.5 text-text-muted">暂无历史订单</div>
      ) : (
        <>
          <div className="mb-3.5 rounded-[18px] border border-border/18 bg-gradient-to-b from-white/[0.02] to-white/[0.01] p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-widest text-text-muted">最近订单回放</div>
                <div className="mt-1.5 text-lg font-extrabold text-text-primary">{buildOrderReplay(orderHistory[0])}</div>
              </div>
              <div className="text-xs font-semibold text-text-muted">{formatDateTime(orderHistory[0]?.created_at)}</div>
            </div>
            <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-2.5">
              <MetricCell label="事件" value={orderHistory[0]?.event_type || '-'} valueClassName={orderEventColor(orderHistory[0]?.event_type)} />
              <MetricCell label="状态" value={orderHistory[0]?.status || '-'} valueClassName={statusColor(orderHistory[0]?.status)} />
              <MetricCell label="价格" value={Number(orderHistory[0]?.price ?? 0).toFixed(2)} />
              <MetricCell label="数量" value={Number(orderHistory[0]?.qty ?? 0).toFixed(6)} />
              <MetricCell label="仓位 ID" value={orderHistory[0]?.position_id || '-'} valueClassName="font-mono text-[13px]" />
            </div>
            <div className="mt-3 rounded-[14px] border border-border/30 bg-white/[0.04] p-3 text-[13px] leading-relaxed text-text-secondary">
              <strong>执行摘要：</strong>{renderOrderMetaSummary(orderHistory[0])}
            </div>
          </div>
          <ScrollArea className="max-h-[420px]">
            <div className="grid gap-3 pr-1">
              {orderHistory.map((order) => {
                const eventCls = orderEventColor(order.event_type)
                const dotCls = orderEventDotColor(order.event_type)
                const orderStatusCls = statusColor(order.status)
                return (
                  <div key={order.id} className="grid grid-cols-[140px_12px_minmax(0,1fr)] items-stretch gap-3">
                    <div className="pt-2 text-xs text-text-muted">{formatDateTime(order.created_at)}</div>
                    <div className="flex justify-center" aria-hidden>
                      <div className="relative w-0.5 rounded-full bg-gradient-to-b from-blue-600/[0.28] to-slate-400/[0.08]">
                        <div className={`absolute top-2.5 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rounded-full ${dotCls}`} />
                      </div>
                    </div>
                    <div className="rounded-[18px] border border-border/18 bg-gradient-to-b from-white/[0.02] to-white/[0.01] p-3.5 shadow-[0_12px_28px_rgba(15,23,42,0.06)]">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2.5">
                          <strong className="text-[15px] text-text-primary">{order.symbol}</strong>
                          <Badge className={eventCls}>{order.event_type || 'open'}</Badge>
                          <Badge className={orderStatusCls}>{order.status}</Badge>
                          <Badge className="bg-violet-500/12 text-violet-400">{order.side}</Badge>
                        </div>
                        <div className="text-xs font-semibold text-text-muted">来源：{order.source || 'manual'}</div>
                      </div>
                      <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-2.5">
                        <MetricCell label="价格" value={Number(order.price ?? 0).toFixed(2)} />
                        <MetricCell label="数量" value={Number(order.qty ?? 0).toFixed(6)} />
                        <MetricCell label="仓位 ID" value={order.position_id || '-'} valueClassName="font-mono text-[13px]" />
                      </div>
                      <div className="mt-3 rounded-[14px] border border-border/30 bg-white/[0.03] p-3 text-[13px] leading-relaxed text-text-secondary">
                        {renderOrderMetaSummary(order)}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </ScrollArea>
        </>
      )}
    </div>
  )
}

export function RunnerLogsCard({ runnerLogs }: { runnerLogs: RunnerLogItem[] }) {
  return (
    <div className="rounded-3xl border border-white/[0.08] bg-gradient-to-b from-[rgba(16,18,24,0.96)] to-[rgba(11,13,18,0.98)] p-5 shadow-[0_22px_44px_rgba(0,0,0,0.22)] backdrop-blur-[10px]">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold tracking-tight text-text-primary">最近策略执行</h2>
          <div className="mt-1.5 text-xs text-text-muted">按执行时间倒序查看动作、信号、数据源状态与事件落地结果。</div>
        </div>
        <Badge className="bg-slate-500/[0.08] text-text-primary">{runnerLogs?.length || 0} 条记录</Badge>
      </div>
      {!runnerLogs || runnerLogs.length === 0 ? (
        <div className="rounded-[18px] border border-border/18 bg-gradient-to-b from-white/[0.02] to-white/[0.01] p-3.5 text-text-muted">暂无执行日志</div>
      ) : (
        <>
          {(() => {
            const latest = runnerLogs[runnerLogs.length - 1]
            const latestPayload = getRunnerPayload(latest?.result)
            const latestEvent = getRunnerEvent(latest?.result)
            return (
              <div className="mb-3.5 rounded-[18px] border border-border/18 bg-gradient-to-b from-blue-950/40 to-white/[0.01] p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-widest text-text-muted">最近一次决策解释</div>
                    <div className="mt-1.5 text-lg font-extrabold text-text-primary">{latestPayload?.action || latestPayload?.reason || 'unknown'}</div>
                  </div>
                  <div className="text-xs font-semibold text-text-muted">{formatDateTime(latest?.ts)}</div>
                </div>
                <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-2.5">
                  <div>
                    <div className="text-xs text-text-muted">信号</div>
                    <div className="text-[15px] font-bold text-text-primary">{String(latestPayload?.signal ?? '-')}</div>
                  </div>
                  <div>
                    <div className="text-xs text-text-muted">价格</div>
                    <div className="text-[15px] font-bold text-text-primary">{latestPayload?.price !== undefined && latestPayload?.price !== null ? Number(latestPayload.price).toFixed(2) : '-'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-text-muted">数据源</div>
                    <div className={`text-[15px] font-bold ${marketDataColorClass(latestPayload?.market_data)}`}>{formatMarketDataStatus(latestPayload?.market_data)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-text-muted">事件</div>
                    <div className="text-[15px] font-bold text-text-primary">{latestEvent?.event_type || '-'}</div>
                  </div>
                </div>
                <div className="mt-3 rounded-[14px] border border-border/30 bg-white/[0.04] p-3 text-[13px] leading-relaxed text-text-secondary">
                  <div><strong>执行摘要：</strong>{renderRunnerExecutionSummary(latest?.result)}</div>
                  <div className="mt-2"><strong>事件详情：</strong>{latestEvent ? renderRunnerEventSummary(latest?.result) : '暂无事件写入'}</div>
                </div>
              </div>
            )
          })()}
          <ScrollArea className="max-h-[420px]">
            <div className="grid gap-3 pr-1">
              {runnerLogs.slice().reverse().map((item: RunnerLogItem, idx: number) => {
                const runnerPayload = getRunnerPayload(item.result)
                const runnerEvent = getRunnerEvent(item.result)
                const actionCls = actionColor(runnerPayload?.action || runnerPayload?.reason || 'unknown')
                const dotCls = actionDotColor(runnerPayload?.action || runnerPayload?.reason || 'unknown')
                return (
                  <div key={`${item.ts}-${idx}`} className="grid grid-cols-[140px_12px_minmax(0,1fr)] items-stretch gap-3">
                    <div className="pt-2 text-xs text-text-muted">{formatDateTime(item.ts)}</div>
                    <div className="flex justify-center" aria-hidden>
                      <div className="relative w-0.5 rounded-full bg-gradient-to-b from-blue-600/[0.28] to-slate-400/[0.08]">
                        <div className={`absolute top-2.5 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rounded-full ${dotCls}`} />
                      </div>
                    </div>
                    <div className="rounded-[18px] border border-border/18 bg-gradient-to-b from-white/[0.02] to-white/[0.01] p-3.5 shadow-[0_12px_28px_rgba(15,23,42,0.06)]">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2.5">
                          <strong className="text-[15px] text-text-primary">{runnerPayload?.action || runnerPayload?.reason || 'unknown'}</strong>
                          <Badge className={actionCls}>{item.config?.symbol || '-'}</Badge>
                          <Badge className="bg-slate-500/18 text-slate-300">{item.config?.timeframe || '-'}</Badge>
                          <Badge className="bg-blue-500/14 text-blue-400">{item.config?.strategy_type || '-'}</Badge>
                          {runnerEvent?.event_type ? <Badge className={orderEventColor(runnerEvent.event_type)}>{runnerEvent.event_type}</Badge> : null}
                        </div>
                        <div className="text-xs font-semibold text-text-muted">
                          数据源：
                          <span className={`font-extrabold ${marketDataColorClass(runnerPayload?.market_data)}`}>
                            {formatMarketDataStatus(runnerPayload?.market_data)}
                          </span>
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-2.5">
                        <MetricCell label="信号" value={String(runnerPayload?.signal ?? '-')} />
                        <MetricCell label="价格" value={runnerPayload?.price !== undefined && runnerPayload?.price !== null ? Number(runnerPayload.price).toFixed(2) : '-'} />
                        <MetricCell label="来源" value={runnerEvent?.source || '-'} />
                        <MetricCell label="仓位 ID" value={runnerEvent?.position_id || '-'} valueClassName="font-mono text-[13px]" />
                      </div>

                      <div className="mt-3 rounded-[14px] border border-border/30 bg-white/[0.03] p-3 text-[13px] leading-relaxed text-text-secondary">
                        <div><strong>执行摘要：</strong>{renderRunnerExecutionSummary(item.result)}</div>
                        {runnerEvent ? <div className="mt-2"><strong>事件详情：</strong>{renderRunnerEventSummary(item.result)}</div> : null}
                        {runnerPayload?.market_data?.warning ? (
                          <div className="mt-2 text-amber-400"><strong>警告：</strong>{runnerPayload.market_data.warning}</div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </ScrollArea>
        </>
      )}
    </div>
  )
}
