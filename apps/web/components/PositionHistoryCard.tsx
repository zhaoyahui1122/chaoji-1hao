import { useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'

import type { HistoryPosition } from './dashboard-types'
import { exportTradesUrl } from '../lib/api'
import { formatDateTime, formatMoney, formatPercent, parseMetaJson, readPositionTargetPrice } from './dashboard-utils'

function sideColor(side?: string): string {
  return String(side || '').toLowerCase() === 'long'
    ? 'bg-blue-500/15 text-blue-400'
    : 'bg-violet-500/12 text-violet-400'
}

function pnlColorClass(pnl: number): string {
  if (pnl > 0) return 'text-accent-green'
  if (pnl < 0) return 'text-accent-red'
  return 'text-text-secondary'
}

function SummaryMetric({ label, value, valueClassName }: { label: string; value: React.ReactNode; valueClassName?: string }) {
  return (
    <div className="rounded-xl border border-border/50 bg-bg-card/60 p-3">
      <div className="text-xs text-text-muted">{label}</div>
      <div className={`mt-1.5 text-sm font-bold break-words text-text-primary ${valueClassName ?? ''}`}>{value}</div>
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

type FilterKey = 'symbol' | 'side' | 'pnl'

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-bold cursor-pointer border transition-colors ${
        active
          ? 'border-blue-500/50 bg-blue-500/12 text-blue-400'
          : 'border-border/25 bg-bg-card/60 text-text-muted hover:bg-bg-card'
      }`}
    >
      {label}
    </button>
  )
}

export default function PositionHistoryCard({
  positionHistory,
}: {
  positionHistory: HistoryPosition[]
}) {
  const [symbolFilter, setSymbolFilter] = useState<string>('')
  const [sideFilter, setSideFilter] = useState<string>('')
  const [pnlFilter, setPnlFilter] = useState<string>('')

  const filtered = useMemo(() => {
    return positionHistory.filter((pos) => {
      if (symbolFilter && pos.symbol !== symbolFilter) return false
      if (sideFilter && String(pos.side).toLowerCase() !== sideFilter) return false
      if (pnlFilter) {
        const pnl = Number(pos.realized_pnl ?? 0)
        if (pnlFilter === 'profit' && pnl <= 0) return false
        if (pnlFilter === 'loss' && pnl >= 0) return false
      }
      return true
    })
  }, [positionHistory, symbolFilter, sideFilter, pnlFilter])

  const toggle = (current: string, value: string) => current === value ? '' : value

  return (
    <div className="rounded-3xl border border-white/[0.08] bg-gradient-to-b from-[rgba(16,18,24,0.96)] to-[rgba(11,13,18,0.98)] p-5 shadow-[0_22px_44px_rgba(0,0,0,0.22)] backdrop-blur-[10px]">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold tracking-tight text-text-primary">历史持仓</h2>
          <div className="mt-1.5 text-xs text-text-muted">这里只看最关键的结果：开仓价、平仓价、净盈亏，以及按保证金和名义价值计算的净收益率（已计入买入和卖出手续费）。</div>
        </div>
        <a
          href={exportTradesUrl('paper', 'csv')}
          download="trades.csv"
          className="whitespace-nowrap rounded-[10px] bg-gradient-to-br from-slate-900 to-slate-800 px-3.5 py-2 text-[13px] font-bold text-white no-underline hover:opacity-90 transition-opacity"
        >
          导出 CSV
        </a>
      </div>

      <div className="mb-3.5 flex flex-wrap gap-5">
        <div className="flex items-center gap-1.5">
          <span className="min-w-8 text-xs font-bold text-text-muted">币种</span>
          <FilterChip label="全部" active={!symbolFilter} onClick={() => setSymbolFilter('')} />
          <FilterChip label="BTC" active={symbolFilter === 'BTC_USDT'} onClick={() => setSymbolFilter(toggle(symbolFilter, 'BTC_USDT'))} />
          <FilterChip label="ETH" active={symbolFilter === 'ETH_USDT'} onClick={() => setSymbolFilter(toggle(symbolFilter, 'ETH_USDT'))} />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="min-w-8 text-xs font-bold text-text-muted">方向</span>
          <FilterChip label="全部" active={!sideFilter} onClick={() => setSideFilter('')} />
          <FilterChip label="多" active={sideFilter === 'long'} onClick={() => setSideFilter(toggle(sideFilter, 'long'))} />
          <FilterChip label="空" active={sideFilter === 'short'} onClick={() => setSideFilter(toggle(sideFilter, 'short'))} />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="min-w-8 text-xs font-bold text-text-muted">盈亏</span>
          <FilterChip label="全部" active={!pnlFilter} onClick={() => setPnlFilter('')} />
          <FilterChip label="盈利" active={pnlFilter === 'profit'} onClick={() => setPnlFilter(toggle(pnlFilter, 'profit'))} />
          <FilterChip label="亏损" active={pnlFilter === 'loss'} onClick={() => setPnlFilter(toggle(pnlFilter, 'loss'))} />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-[18px] border border-border/18 bg-gradient-to-b from-white/[0.02] to-white/[0.01] p-3.5 text-text-muted">暂无历史持仓</div>
      ) : (
        <ScrollArea className="max-h-[420px]">
          <div className="grid gap-3 pr-1">
            {filtered.map((position) => {
              const realizedPnl = Number(position.realized_pnl ?? 0)
              const pnlColor = pnlColorClass(realizedPnl)
              const { marginRate, notionalRate } = deriveRates(position)
              const stopLossPrice = readPositionTargetPrice(position.open_meta_json, 'stop_loss_price')
              const takeProfitPrice = readPositionTargetPrice(position.open_meta_json, 'take_profit_price')

              return (
                <div key={position.id} className="rounded-[18px] border border-border/18 bg-gradient-to-b from-white/[0.02] to-white/[0.01] p-3.5 shadow-[0_12px_28px_rgba(15,23,42,0.06)]">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <strong className="text-[15px] text-text-primary">{position.symbol}</strong>
                      <Badge className={sideColor(position.side)}>{position.side}</Badge>
                    </div>
                    <div className={`text-2xl font-extrabold ${pnlColor}`}>
                      {position.realized_pnl == null ? '-' : formatMoney(position.realized_pnl)}
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-2.5">
                    <SummaryMetric label="开仓时间" value={formatDateTime(position.opened_at)} />
                    <SummaryMetric label="平仓时间" value={formatDateTime(position.closed_at)} />
                    <SummaryMetric label="开仓价" value={Number(position.entry_price ?? 0).toFixed(2)} />
                    <SummaryMetric label="止损价" value={formatTargetPrice(stopLossPrice)} />
                    <SummaryMetric label="止盈价" value={formatTargetPrice(takeProfitPrice)} />
                    <SummaryMetric label="平仓价" value={position.close_price == null ? '-' : Number(position.close_price).toFixed(2)} />
                    <SummaryMetric label="盈利" value={position.realized_pnl == null ? '-' : formatMoney(position.realized_pnl)} valueClassName={pnlColor} />
                    <SummaryMetric label={pnlRateLabel('保证金收益率', marginRate)} value={pnlRateValue(marginRate)} valueClassName={pnlColor} />
                    <SummaryMetric label={pnlRateLabel('名义价值收益率', notionalRate)} value={pnlRateValue(notionalRate)} valueClassName={pnlColor} />
                  </div>
                </div>
              )
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}
