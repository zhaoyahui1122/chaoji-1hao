"use client"

import { useEffect, useMemo, useState } from 'react'

import type { BacktestRunSettings, StrategyConfig, StrategyPriceReference } from './dashboard-types'
import { buildBacktestSelectionKey, diffDaysInclusive, getBacktestDraft, resolveBacktestRunSelection, setBacktestDraft, type BacktestDraftState } from './backtest-date-utils'
import { getStrategySnapshots, rollbackStrategy } from '../lib/api'
import { formatStrategySlotCardSummary } from './runner-ui-utils'
import { Button } from './ui/button'
import { Input } from './ui/input'

type Props = {
  initial: StrategyConfig
  onSave: (config: StrategyConfig, slotId?: number, name?: string) => Promise<void>
  onRunBacktest: (config: StrategyConfig, options: BacktestRunSettings) => Promise<void>
  onInvalidateBacktest?: () => void
  priceReference?: StrategyPriceReference | null
  strategySlotId?: number
  strategySlotName?: string
  strategySlots?: Array<{
    slotId: number
    name?: string
    config: Pick<StrategyConfig, 'symbol' | 'timeframe' | 'strategy_type' | 'leverage' | 'stop_loss_pct' | 'take_profit_pct' | 'risk_per_trade_pct' | 'turtle_entry_period' | 'turtle_exit_period'> & Partial<Pick<StrategyConfig, 'symbols' | 'classic_trend_filter_enabled' | 'classic_cooldown_bars' | 'turtle_atr_period' | 'turtle_atr_filter' | 'turtle_adx_period' | 'turtle_adx_threshold' | 'turtle_force_mode' | 'ict_bos_lookback' | 'ict_risk_reward' | 'fee_rate' | 'slippage_rate'>>
    locked?: boolean
  }>
  onStrategySlotChange?: (slotId: number) => void
  onStrategySlotNameChange?: (slotId: number, name: string) => void
  onAddStrategySlot?: (name?: string) => void
  onDeleteStrategySlot?: (slotId: number) => void
}

const QUICK_BACKTEST_DAYS = [7, 30, 90, 180] as const
const BACKTEST_START_DATE_INPUT_ID = 'backtest-start-date'
const BACKTEST_END_DATE_INPUT_ID = 'backtest-end-date'

function createDefaultBacktestDraft(initial: StrategyConfig): BacktestDraftState {
  return {
    backtestDays: 7,
    backtestStartDate: '',
    backtestEndDate: '',
    backtestSymbol: initial.symbol,
    backtestLeverage: initial.leverage,
  }
}

function formatDateInputValue(value: Date): string {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function shiftDateString(base: string, offsetDays: number): string {
  const date = new Date(`${base}T00:00:00`)
  date.setDate(date.getDate() + offsetDays)
  return formatDateInputValue(date)
}

export default function StrategyForm({ initial, onSave, onRunBacktest, onInvalidateBacktest, priceReference = null, strategySlotId = 1, strategySlotName = '', strategySlots = [], onStrategySlotChange, onStrategySlotNameChange, onAddStrategySlot, onDeleteStrategySlot }: Props) {
  const initialBacktestDraft = getBacktestDraft(strategySlotId, createDefaultBacktestDraft(initial))
  const [form, setForm] = useState<StrategyConfig>(initial)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [backtestDays, setBacktestDays] = useState<number>(initialBacktestDraft.backtestDays)
  const [backtestStartDate, setBacktestStartDate] = useState(initialBacktestDraft.backtestStartDate)
  const [backtestEndDate, setBacktestEndDate] = useState(initialBacktestDraft.backtestEndDate)
  const [backtestSymbol, setBacktestSymbol] = useState<'BTC_USDT' | 'ETH_USDT'>(initialBacktestDraft.backtestSymbol)
  const [backtestLeverage, setBacktestLeverage] = useState(initialBacktestDraft.backtestLeverage)
  const [backtestNotice, setBacktestNotice] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(true)
  const [saveNotice, setSaveNotice] = useState<string | null>(null)
  const [slotNameDraft, setSlotNameDraft] = useState(strategySlotName)
  const [snapshots, setSnapshots] = useState<Array<{ id: number; label: string | null; created_at: string }>>([])
  const [showSnapshots, setShowSnapshots] = useState(false)
  const [rollbackNotice, setRollbackNotice] = useState<string | null>(null)
  const [lastBacktestSelectionKey, setLastBacktestSelectionKey] = useState<string | null>(null)

  // 判断当前策略槽是否锁定
  const currentSlot = strategySlots.find(s => s.slotId === strategySlotId)
  const isLocked = currentSlot?.locked ?? false

  useEffect(() => {
    setForm(initial)
  }, [initial])

  useEffect(() => {
    setSlotNameDraft(strategySlotName)
  }, [strategySlotId, strategySlotName])

  useEffect(() => {
    const draft = getBacktestDraft(strategySlotId, createDefaultBacktestDraft(initial))
    setBacktestDays(draft.backtestDays)
    setBacktestStartDate(draft.backtestStartDate)
    setBacktestEndDate(draft.backtestEndDate)
    setBacktestSymbol(draft.backtestSymbol)
    setBacktestLeverage(draft.backtestLeverage)
  }, [initial, strategySlotId])

  useEffect(() => {
    setBacktestDraft(strategySlotId, {
      backtestDays,
      backtestStartDate,
      backtestEndDate,
      backtestSymbol,
      backtestLeverage,
    })
  }, [backtestDays, backtestEndDate, backtestLeverage, backtestStartDate, backtestSymbol, strategySlotId])

  useEffect(() => {
    if (!saveNotice) return
    const timer = window.setTimeout(() => setSaveNotice(null), 2400)
    return () => window.clearTimeout(timer)
  }, [saveNotice])

  useEffect(() => {
    if (!backtestNotice) return
    const timer = window.setTimeout(() => setBacktestNotice(null), 3000)
    return () => window.clearTimeout(timer)
  }, [backtestNotice])

  useEffect(() => {
    if (!rollbackNotice) return
    const timer = window.setTimeout(() => setRollbackNotice(null), 3000)
    return () => window.clearTimeout(timer)
  }, [rollbackNotice])

  async function loadSnapshots() {
    try {
      const data = await getStrategySnapshots(20)
      setSnapshots(data.snapshots)
      setShowSnapshots(true)
    } catch { /* ignore */ }
  }

  async function handleRollback(snapshotId: number) {
    try {
      const data = await rollbackStrategy(snapshotId)
      setForm(data.config as StrategyConfig)
      setShowSnapshots(false)
      setRollbackNotice(`已回滚到快照 #${snapshotId}`)
    } catch { /* ignore */ }
  }

  const strategyTypeLabel = form.strategy_type === 'turtle' ? '海龟策略' : form.strategy_type === 'ict' ? 'ICT三周期策略' : form.strategy_type === 'macd_trend' ? 'MACD趋势策略' : '经典策略'

  const signalSummary = useMemo(() => {
    if (form.strategy_type === 'turtle') {
      const adxPart = form.turtle_adx_threshold ? `, ADX>${form.turtle_adx_threshold}` : ''
      return `海龟(${form.turtle_entry_period}/${form.turtle_exit_period}, ATR ${form.turtle_atr_period}${adxPart})`
    }
    if (form.strategy_type === 'ict') {
      return `ICT(4h BOS ${form.ict_bos_lookback ?? 20} / 1h FVG / 15m 吞没, 1:${form.ict_risk_reward ?? 2.5})`
    }
    if (form.strategy_type === 'macd_trend') {
      const parts: string[] = []
      if (form.macd_trend_enabled !== false) parts.push(`趋势突破(${form.macd_breakout_lookback ?? 20})`)
      if (form.macd_divergence_enabled !== false) parts.push(`背离(${form.macd_divergence_confirm_lookback ?? 10})`)
      parts.push(`超时${form.macd_signal_expiry ?? 20}根`)
      parts.push(`跟踪止损${form.macd_trailing_stop_pct ?? 2}%`)
      return parts.join(' ｜ ')
    }
    const enabled: string[] = []
    if (form.use_boll) enabled.push(`布林(${form.boll_period}, ${form.boll_std})`)
    if (form.use_rsi) enabled.push(`RSI(${form.rsi_period})`)
    if (form.use_ma) enabled.push(`EMA(${form.ma_short}/${form.ma_long})`)
    if (form.use_macd) enabled.push(`MACD(${form.macd_fast}/${form.macd_slow}/${form.macd_signal})`)
    if (form.use_kdj) enabled.push(`KDJ(${form.kdj_period}/${form.kdj_signal_period})`)
    enabled.push(`评分≥${form.min_signal_score ?? 3}`)
    enabled.push(form.churn_guard_enabled ? '防抖反手开启' : '防抖反手关闭')
    enabled.push(form.classic_trend_filter_enabled ? '趋势过滤开启' : '趋势过滤关闭')
    enabled.push(`冷却${form.classic_cooldown_bars ?? 0}根K线`)
    return enabled.length > 0 ? enabled.join(' ｜ ') : '未启用任何信号条件'
  }, [form])

  function update<K extends keyof StrategyConfig>(key: K, value: StrategyConfig[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const currentBacktestSelectionKey = useMemo(() => buildBacktestSelectionKey({
    backtestDays,
    backtestStartDate,
    backtestEndDate,
    backtestSymbol,
    backtestLeverage,
  }), [backtestDays, backtestStartDate, backtestEndDate, backtestSymbol, backtestLeverage])

  const hasStaleBacktestResult = lastBacktestSelectionKey !== null && lastBacktestSelectionKey !== currentBacktestSelectionKey

  useEffect(() => {
    if (!hasStaleBacktestResult) return
    onInvalidateBacktest?.()
  }, [hasStaleBacktestResult, onInvalidateBacktest])

  async function handleSave() {
    if (isLocked) {
      setSaveNotice('⚠️ 策略已锁定，不允许修改参数')
      return
    }
    setSaving(true)
    try {
      await onSave(form, strategySlotId, slotNameDraft.trim() || `策略 ${strategySlotId}`)
      setCollapsed(true)
      setSaveNotice(`策略 ${strategySlotId} 已保存`)
    } finally {
      setSaving(false)
    }
  }

  function applyQuickRange(days: number) {
    const today = formatDateInputValue(new Date())
    const start = shiftDateString(today, -(days - 1))
    setBacktestDays(days)
    setBacktestStartDate(start)
    setBacktestEndDate(today)
  }

  function handleBacktestStartDateChange(value: string) {
    setBacktestStartDate(value)
    if (value && backtestEndDate && value <= backtestEndDate) {
      setBacktestDays(diffDaysInclusive(value, backtestEndDate))
    }
  }

  function handleBacktestEndDateChange(value: string) {
    setBacktestEndDate(value)
    if (backtestStartDate && value && backtestStartDate <= value) {
      setBacktestDays(diffDaysInclusive(backtestStartDate, value))
    }
  }

  async function handleRunBacktest() {
    const { options, successLabel } = resolveBacktestRunSelection({
      backtestDays,
      backtestStartDate,
      backtestEndDate,
    })

    if (backtestStartDate || backtestEndDate) {
      if (!backtestStartDate || !backtestEndDate) {
        setBacktestNotice('请同时选择开始日期和结束日期')
        return
      }
      if (backtestStartDate > backtestEndDate) {
        setBacktestNotice('开始日期不能晚于结束日期')
        return
      }
      const rangeDays = diffDaysInclusive(backtestStartDate, backtestEndDate)
      if (rangeDays > 365) {
        setBacktestNotice('回测日期范围不能超过 365 天')
        return
      }
    }

    setRunning(true)
    setBacktestNotice(null)
    try {
      await onRunBacktest({ ...form, symbol: backtestSymbol, leverage: backtestLeverage }, options)
      setLastBacktestSelectionKey(currentBacktestSelectionKey)
      setBacktestNotice(`${successLabel} 回测成功`)
    } catch (error) {
      setBacktestNotice(error instanceof Error ? error.message : '回测失败，请稍后重试')
    } finally {
      setRunning(false)
    }
  }

  function handleAddSlot() {
    if (!onAddStrategySlot) return
    const name = window.prompt('新策略名称（可留空）', `策略 ${strategySlots.length + 1}`)
    if (name === null) return
    onAddStrategySlot(name)
  }

  function handleDeleteSlot() {
    if (!onDeleteStrategySlot) return
    const currentName = slotNameDraft.trim() || `策略 ${strategySlotId}`
    const confirmed = window.confirm(`确定删除 ${currentName}（策略 ${strategySlotId}）吗？`)
    if (!confirmed) return
    onDeleteStrategySlot(strategySlotId)
  }

  const slotCards = strategySlots.length > 0 ? strategySlots : [1, 2, 3, 4, 5].map((slotId) => ({
    slotId,
    name: `策略 ${slotId}`,
    config: {
      symbol: form.symbol,
      symbols: form.symbols,
      timeframe: form.timeframe,
      strategy_type: form.strategy_type,
      leverage: form.leverage,
      stop_loss_pct: form.stop_loss_pct,
      take_profit_pct: form.take_profit_pct,
      risk_per_trade_pct: form.risk_per_trade_pct,
      turtle_entry_period: form.turtle_entry_period,
      turtle_exit_period: form.turtle_exit_period,
      turtle_atr_period: form.turtle_atr_period,
      turtle_atr_filter: form.turtle_atr_filter,
      turtle_adx_period: form.turtle_adx_period,
      turtle_adx_threshold: form.turtle_adx_threshold,
      turtle_force_mode: form.turtle_force_mode,
      fee_rate: form.fee_rate,
      slippage_rate: form.slippage_rate,
      classic_trend_filter_enabled: form.classic_trend_filter_enabled,
      classic_cooldown_bars: form.classic_cooldown_bars,
    },
    locked: false,
  }))

  return (
    <div className="grid gap-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid min-w-[280px] flex-1 gap-3">
          <div className="text-[13px] font-extrabold text-text-primary">策略参数面板</div>
          <div className="grid gap-2.5">
            <div className="text-xs uppercase tracking-[0.08em] text-text-muted">策略槽位</div>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-2.5">
              {slotCards.map((slot) => {
                const active = slot.slotId === strategySlotId
                const locked = slot.locked ?? false
                return (
                  <button
                    key={slot.slotId}
                    type="button"
                    onClick={() => onStrategySlotChange?.(slot.slotId)}
                    className={`grid gap-1 rounded-2xl p-3 text-left text-text-primary transition-all duration-200 ${
                      active
                        ? 'border border-accent-cyan/30 bg-gradient-to-br from-[#1b1e24] to-[#2a2e35] shadow-lg'
                        : locked
                          ? 'border border-accent-amber/30 bg-gradient-to-br from-[#3a2f1f] to-[#4b3d27] shadow-md'
                          : 'border border-white/8 bg-gradient-to-b from-white/[0.04] to-white/[0.02]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <strong className="text-sm">{slot.name || `策略 ${slot.slotId}`}</strong>
                      <div className="flex items-center gap-1.5">
                        {locked ? <span className="text-sm">🔒</span> : null}
                        <span className={`rounded-full px-2 py-1 text-[11px] font-extrabold ${
                          active ? 'bg-white/12 text-text-secondary' : locked ? 'bg-white/8 text-text-secondary' : 'bg-white/6 text-text-secondary'
                        }`}>#{slot.slotId}</span>
                      </div>
                    </div>
                    <div className={`mt-2 text-xs leading-relaxed ${active ? 'text-white/78' : 'text-text-secondary'}`}>
                      {(slot.config.symbols ?? [slot.config.symbol]).join(' / ')} · {slot.config.timeframe} · {slot.config.strategy_type === 'turtle' ? '海龟' : slot.config.strategy_type === 'ict' ? 'ICT三周期' : slot.config.strategy_type === 'macd_trend' ? 'MACD趋势' : '经典'}
                    </div>
                    <div className={`mt-0.5 text-[11px] leading-snug ${active ? 'text-white/62' : 'text-text-muted'}`}>
                      实际杠杆以交易工作区选择为准
                    </div>
                    <div className={`mt-1 text-xs leading-relaxed ${active ? 'text-white/72' : 'text-text-muted'}`}>
                      SL {(slot.config.stop_loss_pct * 100).toFixed(2)}% ｜ TP {(slot.config.take_profit_pct * 100).toFixed(2)}% ｜ Risk {(slot.config.risk_per_trade_pct * 100).toFixed(2)}%
                    </div>
                    {slot.config.strategy_type === 'turtle' ? (
                      <div className={`mt-1 text-xs leading-relaxed ${active ? 'text-white/72' : 'text-text-muted'}`}>
                        Entry {slot.config.turtle_entry_period} ｜ Exit {slot.config.turtle_exit_period} ｜ ATR {slot.config.turtle_atr_period ?? '-'} ｜ ATR Filter {slot.config.turtle_atr_filter ?? '-'}
                      </div>
                    ) : null}
                    {slot.config.strategy_type === 'turtle' ? (
                      <div className={`mt-1 text-xs leading-relaxed ${active ? 'text-white/72' : 'text-text-muted'}`}>
                        ADX {slot.config.turtle_adx_period ?? '-'} ｜ Threshold {slot.config.turtle_adx_threshold ?? '-'} ｜ Mode {slot.config.turtle_force_mode || '-'} ｜ Fee {slot.config.fee_rate ?? '-'} ｜ Slippage {slot.config.slippage_rate ?? '-'}
                      </div>
                    ) : null}
                    {slot.config.strategy_type === 'ict' ? (
                      <div className={`mt-1 text-xs leading-relaxed ${active ? 'text-white/72' : 'text-text-muted'}`}>
                        BOS {slot.config.ict_bos_lookback ?? 20} ｜ RR 1:{slot.config.ict_risk_reward ?? 2.5} ｜ 4h BOS + 1h FVG + 15m 吞没
                      </div>
                    ) : null}
                    {locked ? (
                      <div className={`mt-1.5 text-[11px] leading-relaxed italic ${active ? 'text-white/65' : 'text-accent-amber'}`}>
                        🔒 优化参数已锁定
                      </div>
                    ) : null}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={handleAddSlot}>
              添加策略
            </Button>
            <Button variant="destructive" size="sm" onClick={handleDeleteSlot} disabled={strategySlots.length <= 1 || isLocked}>
              {isLocked ? '🔒 锁定策略' : '删除当前策略'}
            </Button>
          </div>

          <label className="flex flex-wrap items-center gap-1.5 text-xs text-text-secondary">
            <span>保存策略名称</span>
            <Input
              value={slotNameDraft}
              onChange={(e) => setSlotNameDraft(e.target.value)}
              onBlur={() => onStrategySlotNameChange?.(strategySlotId, slotNameDraft)}
              placeholder={`策略 ${strategySlotId}`}
              className="min-w-[220px]"
            />
          </label>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-bold text-text-secondary">Runner 交易对</span>
            {(['BTC_USDT', 'ETH_USDT'] as const).map((sym) => {
              const active = (form.symbols ?? [form.symbol]).includes(sym)
              return (
                <button
                  key={sym}
                  type="button"
                  onClick={() => {
                    const current = form.symbols ?? [form.symbol]
                    let next: Array<'BTC_USDT' | 'ETH_USDT'>
                    if (active && current.length > 1) {
                      next = current.filter((s) => s !== sym)
                    } else if (!active) {
                      next = [...current, sym]
                    } else {
                      return
                    }
                    update('symbols' as any, next as any)
                  }}
                  className={`rounded-full border-0 px-3.5 py-2 text-[13px] font-extrabold text-text-primary ${
                    active ? 'bg-gradient-to-br from-[#2a2e35] to-[#363b44]' : 'bg-white/6'
                  }`}
                >
                  {sym === 'BTC_USDT' ? 'BTC' : 'ETH'}
                </button>
              )
            })}
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => setCollapsed((prev) => !prev)}>
          {collapsed ? '展开参数' : '收起参数'}
        </Button>
      </div>

      {saveNotice ? (
        <div className="rounded-[14px] border border-accent-green/26 bg-accent-green/15 px-3 py-2.5 text-xs font-bold text-accent-green shadow-lg">
          {saveNotice}
        </div>
      ) : null}
      {backtestNotice ? (
        <div className="rounded-[14px] border border-accent-green/20 bg-gradient-to-br from-green-100 to-green-200 px-3 py-2.5 text-xs font-bold text-green-800 shadow-lg">
          {backtestNotice}
        </div>
      ) : null}
      {hasStaleBacktestResult ? (
        <div className="rounded-[14px] border border-accent-amber/30 bg-gradient-to-br from-amber-100 to-amber-200 px-3 py-2.5 text-xs font-bold text-amber-800 shadow-lg">
          回测参数已变更，下方结果仍是上一次回测的数据，请重新点击"运行回测"刷新。
        </div>
      ) : null}

      {isLocked ? (
        <div className="flex items-center gap-2.5 rounded-[14px] border border-accent-amber/35 bg-gradient-to-br from-amber-100 to-amber-200 px-4 py-3">
          <span className="text-lg">🔒</span>
          <div>
            <div className="text-[13px] font-extrabold text-amber-800">策略参数已锁定</div>
            <div className="mt-0.5 text-xs text-amber-700">此策略使用优化后的15分钟海龟参数（ADX 35+趋势过滤），不允许修改或删除。如需自定义策略，请添加新策略槽。</div>
          </div>
        </div>
      ) : null}

      {collapsed ? (
        <div className="grid gap-3 rounded-[20px] border border-white/8 bg-bg-card p-4 shadow-lg">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-2.5">
            <ValueMetric label="策略类型" valueText={strategyTypeLabel} />
            <ValueMetric label="已启用信号" valueText={signalSummary} />
            {form.strategy_type === 'turtle' ? (
              <>
                <ValueMetric label="入场周期" valueText={String(form.turtle_entry_period)} />
                <ValueMetric label="出场周期" valueText={String(form.turtle_exit_period)} />
                <ValueMetric label="ATR 周期" valueText={String(form.turtle_atr_period)} />
                <ValueMetric label="ATR 过滤" valueText={String(form.turtle_atr_filter)} />
                <ValueMetric label="ADX 周期" valueText={String(form.turtle_adx_period ?? '-')} />
                <ValueMetric label="ADX 门槛" valueText={String(form.turtle_adx_threshold ?? '-')} />
                <ValueMetric label="强制模式" valueText={form.turtle_force_mode || '-'} />
                <ValueMetric label="手续费率" valueText={String(form.fee_rate)} />
                <ValueMetric label="滑点率" valueText={String(form.slippage_rate)} />
              </>
            ) : form.strategy_type === 'ict' ? (
              <>
                <ValueMetric label="BOS 回看" valueText={String(form.ict_bos_lookback ?? 20)} />
                <ValueMetric label="风险回报比" valueText={`1:${form.ict_risk_reward ?? 2.5}`} />
              </>
            ) : form.strategy_type === 'macd_trend' ? (
              <>
                <ValueMetric label="信号超时" valueText={`${form.macd_signal_expiry ?? 20} 根`} />
                <ValueMetric label="跟踪止损" valueText={`${form.macd_trailing_stop_pct ?? 2}%`} />
                <ValueMetric label="衰减基数" valueText={String(form.macd_trailing_decay_base ?? 0.98)} />
                <ValueMetric label="衰减下限" valueText={String(form.macd_trailing_decay_floor ?? 0.3)} />
              </>
            ) : (
              <>
                <ValueMetric label="止损" valueText={`${(form.stop_loss_pct * 100).toFixed(2)}%`} tone="danger" />
                <ValueMetric label="止盈" valueText={`${(form.take_profit_pct * 100).toFixed(2)}%`} />
              </>
            )}
          </div>
        </div>
      ) : null}

      {!collapsed ? (
        <>


          {priceReference && priceReference.symbol === form.symbol ? (
            form.strategy_type === 'ict' ? (
              <div className="grid gap-2.5 rounded-[18px] border border-accent-cyan/18 bg-gradient-to-b from-[#111924]/98 to-[#0c1118] p-3.5 shadow-lg">
                <div className="text-[13px] leading-relaxed text-accent-green">
                  ICT 策略的止损止盈由 1h FVG 边界和 1:{form.ict_risk_reward ?? 2.5} 风险回报比决定，执行时由后端实时计算。
                </div>
              </div>
            ) : (
              <div className="grid gap-2.5 rounded-[18px] border border-accent-cyan/18 bg-gradient-to-b from-[#111924]/98 to-[#0c1118] p-3.5 shadow-lg">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-[13px] font-extrabold text-text-primary">实时参考价</div>
                    <div className="mt-1 text-xs text-text-muted">
                      {priceReference.symbol} · {priceReference.timeframe} · 默认按 long 口径推导止损止盈
                    </div>
                  </div>
                  <div className="text-xs text-text-secondary">止损比例：{(priceReference.stop_loss_pct * 100).toFixed(2)}% · 止盈比例：{(priceReference.take_profit_pct * 100).toFixed(2)}%</div>
                </div>
                <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-2.5">
                  <PriceMetric label="当前实时价" value={priceReference.live_price} />
                  <PriceMetric label="当前标记价" value={priceReference.mark_price} />
                  <PriceMetric label="默认 Entry" value={priceReference.default_entry_price} />
                  <PriceMetric label="推导 Stop Loss" value={priceReference.derived_stop_loss_price} tone="danger" />
                  <PriceMetric label="推导 Take Profit" value={priceReference.derived_take_profit_price} />
                </div>
              </div>
            )
          ) : null}

          <div className="grid gap-3 rounded-[20px] border border-white/8 bg-bg-card p-4 shadow-lg">
            <div className="text-[13px] font-extrabold text-text-primary">信号参数</div>

            {form.strategy_type === 'turtle' ? (
              <div className="grid gap-3 rounded-[18px] border border-white/8 bg-bg-card p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <div className="grid gap-1">
                  <strong className="text-sm text-text-primary">海龟策略参数</strong>
                  <div className="text-xs text-text-muted">突破入场、回撤退出、ATR 波动过滤。</div>
                  <div className="rounded-[10px] border border-accent-blue/12 bg-accent-blue/8 px-2.5 py-2 text-xs text-accent-blue">
                    当前已切换为海龟策略，经典指标参数不会参与本次信号计算。
                  </div>
                </div>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
                  <FieldRow label="入场周期" type="number" value={form.turtle_entry_period} onChange={(v) => update('turtle_entry_period', Number(v))} disabled={isLocked} />
                  <FieldRow label="出场周期" type="number" value={form.turtle_exit_period} onChange={(v) => update('turtle_exit_period', Number(v))} disabled={isLocked} />
                  <FieldRow label="ATR 周期" type="number" value={form.turtle_atr_period} onChange={(v) => update('turtle_atr_period', Number(v))} disabled={isLocked} />
                  <FieldRow label="ATR 过滤阈值" type="number" step="0.1" value={form.turtle_atr_filter} onChange={(v) => update('turtle_atr_filter', Number(v))} disabled={isLocked} />
                  <FieldRow label="ADX 周期" type="number" value={form.turtle_adx_period ?? 14} onChange={(v) => update('turtle_adx_period' as any, Number(v))} disabled={isLocked} />
                  <FieldRow label="ADX 趋势门槛" type="number" step="1" value={form.turtle_adx_threshold ?? 25} onChange={(v) => update('turtle_adx_threshold' as any, Number(v))} disabled={isLocked} />
                  <FieldRow label="手续费率" type="number" step="0.0001" value={form.fee_rate} onChange={(v) => update('fee_rate', Number(v))} disabled={isLocked} />
                  <FieldRow label="滑点率" type="number" step="0.0001" value={form.slippage_rate} onChange={(v) => update('slippage_rate', Number(v))} disabled={isLocked} />
                </div>
              </div>
            ) : form.strategy_type === 'ict' ? (
              <div className="grid gap-3 rounded-[18px] border border-white/8 bg-bg-card p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <div className="grid gap-1">
                  <strong className="text-sm text-text-primary">ICT 三周期策略参数</strong>
                  <div className="text-xs text-text-muted">4h BOS 趋势过滤 + 1h FVG 区域 + 15m 吞没入场。</div>
                  <div className="rounded-[10px] border border-accent-green/12 bg-accent-green/8 px-2.5 py-2 text-xs text-accent-green">
                    ICT 策略自动拉取 4h / 1h / 15m 三组数据，止损止盈由 FVG 边界和风险回报比决定。
                  </div>
                </div>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
                  <FieldRow label="BOS 回看周期" type="number" value={form.ict_bos_lookback ?? 20} onChange={(v) => update('ict_bos_lookback' as any, Number(v))} disabled={isLocked} />
                  <FieldRow label="风险回报比" type="number" step="0.1" value={form.ict_risk_reward ?? 2.5} onChange={(v) => update('ict_risk_reward' as any, Number(v))} disabled={isLocked} />
                </div>
              </div>
            ) : form.strategy_type === 'macd_trend' ? (
              <div className="grid gap-3 rounded-[18px] border border-white/8 bg-bg-card p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <div className="grid gap-1">
                  <strong className="text-sm text-text-primary">MACD 趋势 + 背离策略参数</strong>
                  <div className="text-xs text-text-muted">MACD 金叉/死叉趋势突破 + 价格-MACD 背离反转，动态跟踪止损出场。</div>
                  <div className="rounded-[10px] border border-accent-cyan/12 bg-accent-cyan/8 px-2.5 py-2 text-xs text-accent-cyan">
                    只用 MACD 一个指标。信号超时自动失效，不会死扛。无固定止盈，靠跟踪止损让利润奔跑。
                  </div>
                </div>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
                  <FieldRow label="MACD 快线" type="number" value={form.macd_fast ?? 12} onChange={(v) => update('macd_fast', Number(v))} disabled={isLocked} />
                  <FieldRow label="MACD 慢线" type="number" value={form.macd_slow ?? 26} onChange={(v) => update('macd_slow', Number(v))} disabled={isLocked} />
                  <FieldRow label="MACD 信号线" type="number" value={form.macd_signal ?? 9} onChange={(v) => update('macd_signal', Number(v))} disabled={isLocked} />
                </div>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
                  <IndicatorToggleCard title="趋势突破" checked={form.macd_trend_enabled !== false} onToggle={(checked) => update('macd_trend_enabled' as any, checked)} hint="金叉/死叉后价格突破前N根K线高低点开仓。">
                    <FieldRow label="突破回看周期" type="number" value={form.macd_breakout_lookback ?? 20} onChange={(v) => update('macd_breakout_lookback' as any, Number(v))} disabled={isLocked || form.macd_trend_enabled === false} />
                  </IndicatorToggleCard>
                  <IndicatorToggleCard title="背离反转" checked={form.macd_divergence_enabled !== false} onToggle={(checked) => update('macd_divergence_enabled' as any, checked)} hint="价格与MACD背离时准备反转信号。">
                    <FieldRow label="背离确认周期" type="number" value={form.macd_divergence_confirm_lookback ?? 10} onChange={(v) => update('macd_divergence_confirm_lookback' as any, Number(v))} disabled={isLocked || form.macd_divergence_enabled === false} />
                  </IndicatorToggleCard>
                </div>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
                  <FieldRow label="信号超时（根K线）" type="number" value={form.macd_signal_expiry ?? 20} onChange={(v) => update('macd_signal_expiry' as any, Number(v))} disabled={isLocked} />
                  <FieldRow label="跟踪止损比例(%)" type="number" step="0.1" value={form.macd_trailing_stop_pct ?? 2.0} onChange={(v) => update('macd_trailing_stop_pct' as any, Number(v))} disabled={isLocked} />
                </div>
                <div className="grid gap-3 rounded-[18px] border border-white/8 bg-bg-card p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                  <div className="grid gap-1">
                    <strong className="text-sm text-text-primary">动态衰减系数</strong>
                    <div className="text-xs text-text-muted">持仓越久止损越紧，锁住利润。衰减基数越小衰减越快，下限决定止损最紧能到原始的百分之几。</div>
                  </div>
                  <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
                    <FieldRow label="衰减基数" type="number" step="0.01" value={form.macd_trailing_decay_base ?? 0.98} onChange={(v) => update('macd_trailing_decay_base' as any, Number(v))} disabled={isLocked} />
                    <FieldRow label="衰减下限" type="number" step="0.05" value={form.macd_trailing_decay_floor ?? 0.3} onChange={(v) => update('macd_trailing_decay_floor' as any, Number(v))} disabled={isLocked} />
                  </div>
                </div>
              </div>
            ) : (
              <>
                <IndicatorToggleCard
                  title="布林带"
                  checked={form.use_boll}
                  onToggle={(checked) => update('use_boll', checked)}
                  hint="勾上后才参与信号判断，并开放参数填写。"
                >
                  <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
                    <FieldRow label="布林周期" type="number" value={form.boll_period} onChange={(v) => update('boll_period', Number(v))} disabled={!form.use_boll} />
                    <FieldRow label="布林标准差" type="number" step="0.1" value={form.boll_std} onChange={(v) => update('boll_std', Number(v))} disabled={!form.use_boll} />
                  </div>
                </IndicatorToggleCard>

                <IndicatorToggleCard
                  title="RSI"
                  checked={form.use_rsi}
                  onToggle={(checked) => update('use_rsi', checked)}
                  hint="勾上后才参与信号判断，并开放参数填写。"
                >
                  <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
                    <FieldRow label="RSI 周期" type="number" value={form.rsi_period} onChange={(v) => update('rsi_period', Number(v))} disabled={!form.use_rsi} />
                    <FieldRow label="RSI 超卖" type="number" value={form.rsi_oversold} onChange={(v) => update('rsi_oversold', Number(v))} disabled={!form.use_rsi} />
                    <FieldRow label="RSI 超买" type="number" value={form.rsi_overbought} onChange={(v) => update('rsi_overbought', Number(v))} disabled={!form.use_rsi} />
                  </div>
                </IndicatorToggleCard>

                <IndicatorToggleCard
                  title="EMA 趋势"
                  checked={form.use_ma}
                  onToggle={(checked) => update('use_ma', checked)}
                  hint="勾上后才参与信号判断，并开放参数填写。"
                >
                  <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
                    <FieldRow label="EMA 快线" type="number" value={form.ma_short} onChange={(v) => update('ma_short', Number(v))} disabled={!form.use_ma} />
                    <FieldRow label="EMA 慢线" type="number" value={form.ma_long} onChange={(v) => update('ma_long', Number(v))} disabled={!form.use_ma} />
                  </div>
                </IndicatorToggleCard>

                <IndicatorToggleCard
                  title="MACD"
                  checked={form.use_macd ?? false}
                  onToggle={(checked) => update('use_macd', checked)}
                  hint="勾上后会要求 MACD 同向确认趋势强弱。"
                >
                  <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
                    <FieldRow label="MACD 快线" type="number" value={form.macd_fast ?? 12} onChange={(v) => update('macd_fast', Number(v))} disabled={!(form.use_macd ?? false)} />
                    <FieldRow label="MACD 慢线" type="number" value={form.macd_slow ?? 26} onChange={(v) => update('macd_slow', Number(v))} disabled={!(form.use_macd ?? false)} />
                    <FieldRow label="MACD 信号线" type="number" value={form.macd_signal ?? 9} onChange={(v) => update('macd_signal', Number(v))} disabled={!(form.use_macd ?? false)} />
                  </div>
                </IndicatorToggleCard>

                <IndicatorToggleCard
                  title="KDJ"
                  checked={form.use_kdj ?? false}
                  onToggle={(checked) => update('use_kdj', checked)}
                  hint="勾上后会要求 KDJ 在超买超卖区给出方向确认。"
                >
                  <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
                    <FieldRow label="KDJ 周期" type="number" value={form.kdj_period ?? 9} onChange={(v) => update('kdj_period', Number(v))} disabled={!(form.use_kdj ?? false)} />
                    <FieldRow label="KDJ 信号周期" type="number" value={form.kdj_signal_period ?? 3} onChange={(v) => update('kdj_signal_period', Number(v))} disabled={!(form.use_kdj ?? false)} />
                    <FieldRow label="KDJ 超卖" type="number" value={form.kdj_oversold ?? 20} onChange={(v) => update('kdj_oversold', Number(v))} disabled={!(form.use_kdj ?? false)} />
                    <FieldRow label="KDJ 超买" type="number" value={form.kdj_overbought ?? 80} onChange={(v) => update('kdj_overbought', Number(v))} disabled={!(form.use_kdj ?? false)} />
                  </div>
                </IndicatorToggleCard>

                <div className="grid gap-3 rounded-[18px] border border-white/8 bg-bg-card p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                  <div className="grid gap-1">
                    <strong className="text-sm text-text-primary">评分触发阈值</strong>
                    <div className="text-xs text-text-muted">分数越低越容易触发，适合提升 15m 交易频率。</div>
                  </div>
                  <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
                    <FieldRow label="最小信号分" type="number" value={form.min_signal_score ?? 3} onChange={(v) => update('min_signal_score', Number(v))} />
                  </div>
                </div>

                <IndicatorToggleCard
                  title="趋势过滤"
                  checked={form.classic_trend_filter_enabled ?? false}
                  onToggle={(checked) => update('classic_trend_filter_enabled', checked)}
                  hint="开启后，经典策略只顺着短均线/长均线方向入场：多单要求短均线不低于长均线，空单要求短均线不高于长均线。"
                >
                  <div className="text-xs leading-relaxed text-text-secondary">
                    这能减少震荡区逆势追单，超级一号默认开启。
                  </div>
                </IndicatorToggleCard>

                <div className="grid gap-3 rounded-[18px] border border-white/8 bg-bg-card p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                  <div className="grid gap-1">
                    <strong className="text-sm text-text-primary">入场冷却</strong>
                    <div className="text-xs text-text-muted">平仓后等待指定根 K 线再允许下一次经典策略开仓，防止刚止损/止盈后立刻反复进场。</div>
                  </div>
                  <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
                    <FieldRow label="冷却K线数" type="number" value={form.classic_cooldown_bars ?? 0} onChange={(v) => update('classic_cooldown_bars', Math.min(100, Math.max(0, Number(v) || 0)))} disabled={isLocked} />
                  </div>
                </div>

                <IndicatorToggleCard
                  title="防频繁反手"
                  checked={form.churn_guard_enabled ?? false}
                  onToggle={(checked) => update('churn_guard_enabled', checked)}
                  hint="开启后，如果价格离当前持仓开仓价的波动还很小，就先拦截 reverse_signal，避免震荡里来回反手。"
                >
                  <div className="text-xs leading-relaxed text-text-secondary">
                    触发逻辑：当反向信号出现，但当前价格距离开仓价的波动仍低于一个小阈值时，Runner 会跳过这次反手。
                  </div>
                </IndicatorToggleCard>
              </>
            )}
          </div>

          <div className="grid gap-3 rounded-[20px] border border-white/8 bg-bg-card p-4 shadow-lg">
            <div className="text-[13px] font-extrabold text-text-primary">风控参数</div>
            {!isLocked ? (
              <>
                <FieldRow label="止损比例" type="number" step="0.001" value={form.stop_loss_pct} onChange={(v) => update('stop_loss_pct', Number(v))} disabled={isLocked} />
                <FieldRow label="止盈比例" type="number" step="0.001" value={form.take_profit_pct} onChange={(v) => update('take_profit_pct', Number(v))} disabled={isLocked} />
                <FieldRow label="单笔风险比例" type="number" step="0.001" value={form.risk_per_trade_pct} onChange={(v) => update('risk_per_trade_pct', Number(v))} disabled={isLocked} />
              </>
            ) : (
              <div className="text-xs leading-relaxed text-text-muted">锁定策略不展示风控参数明细。</div>
            )}
          </div>
        </>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant={isLocked ? 'secondary' : 'default'}
          size="sm"
          onClick={handleSave}
          disabled={saving || isLocked}
        >
          {isLocked ? '🔒 策略已锁定' : saving ? '保存中...' : `保存策略 ${strategySlotId}`}
        </Button>
        <Button variant="outline" size="sm" onClick={loadSnapshots}>
          历史版本
        </Button>
        {rollbackNotice ? <span className="text-[13px] font-bold text-accent-green">{rollbackNotice}</span> : null}
        {showSnapshots && snapshots.length > 0 && (
          <select
            onChange={(e) => { const id = Number(e.target.value); if (id) handleRollback(id) }}
            defaultValue=""
            className="rounded-lg border border-white/8 bg-bg-input px-3 py-2 text-[13px] text-text-primary"
          >
            <option value="" disabled>选择版本回滚...</option>
            {snapshots.map(s => (
              <option key={s.id} value={s.id}>
                #{s.id} {s.label || ''} {new Date(s.created_at).toLocaleString()}
              </option>
            ))}
          </select>
        )}
        {showSnapshots && snapshots.length === 0 && (
          <span className="text-xs text-text-muted">暂无历史版本</span>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-bold text-text-secondary">交易对</span>
          {(['BTC_USDT', 'ETH_USDT'] as const).map((sym) => (
            <Button
              key={sym}
              variant={backtestSymbol === sym ? 'secondary' : 'outline'}
              size="sm"
              onClick={() => setBacktestSymbol(sym)}
            >
              {sym === 'BTC_USDT' ? 'BTC' : 'ETH'}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-bold text-text-secondary">杠杆</span>
          <Input
            type="number"
            min={10}
            max={150}
            step={5}
            value={backtestLeverage}
            onChange={(e) => setBacktestLeverage(Math.min(150, Math.max(10, Number(e.target.value) || 10)))}
            className="w-16 text-center"
          />
          <span className="text-[13px] text-text-muted">x</span>
        </div>
        <div className="grid gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-text-secondary">回测周期</span>
            {QUICK_BACKTEST_DAYS.map((days) => (
              <Button
                key={days}
                variant={backtestDays === days ? 'secondary' : 'outline'}
                size="sm"
                onClick={() => applyQuickRange(days)}
                disabled={running}
                className={running ? 'opacity-70' : ''}
              >
                最近 {days} 天
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label htmlFor={BACKTEST_START_DATE_INPUT_ID} className="grid gap-1.5">
              <span className="text-xs font-bold text-text-muted">开始日期</span>
              <Input
                id={BACKTEST_START_DATE_INPUT_ID}
                type="date"
                value={backtestStartDate}
                onChange={(e) => handleBacktestStartDateChange(e.target.value)}
                max={backtestEndDate || undefined}
              />
            </label>
            <label htmlFor={BACKTEST_END_DATE_INPUT_ID} className="grid gap-1.5">
              <span className="text-xs font-bold text-text-muted">结束日期</span>
              <Input
                id={BACKTEST_END_DATE_INPUT_ID}
                type="date"
                value={backtestEndDate}
                onChange={(e) => handleBacktestEndDateChange(e.target.value)}
                min={backtestStartDate || undefined}
              />
            </label>
            <Button variant="default" size="sm" onClick={handleRunBacktest} disabled={running}>
              {running ? '回测中...' : '运行回测'}
            </Button>
          </div>
          <div className="text-xs text-text-muted">
            支持自然日范围，包含结束日，最大 365 天。填写日期后将优先按日期区间回测。
          </div>
        </div>
      </div>
    </div>
  )
}

function IndicatorToggleCard({ title, checked, onToggle, hint, children }: { title: string; checked: boolean; onToggle: (checked: boolean) => void; hint: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-3 rounded-[18px] border border-white/8 bg-bg-card p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <label className="flex cursor-pointer flex-wrap items-center justify-between gap-3">
        <div className="grid gap-1">
          <div className="flex items-center gap-2.5">
            <input type="checkbox" checked={checked} onChange={(e) => onToggle(e.target.checked)} className="h-[18px] w-[18px]" />
            <strong className="text-sm text-text-primary">{title}</strong>
          </div>
          <div className="text-xs text-text-muted">{hint}</div>
        </div>
        <span className={`rounded-full px-2 py-1 text-[11px] font-extrabold ${
          checked ? 'bg-accent-green/14 text-accent-green' : 'bg-white/8 text-text-secondary'
        }`}>
          {checked ? '已启用' : '未启用'}
        </span>
      </label>
      <div className={checked ? 'opacity-100' : 'opacity-55'}>{children}</div>
    </div>
  )
}

function FieldRow({ label, type = 'text', step, value, onChange, disabled = false }: { label: string; type?: string; step?: string; value: string | number; onChange: (value: string) => void; disabled?: boolean }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs uppercase tracking-[0.08em] text-text-muted">{label}</span>
      <Input
        type={type}
        step={step}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-[14px] px-3.5 py-3 shadow-[inset_0_1px_2px_rgba(0,0,0,0.18)]"
      />
    </label>
  )
}

function SelectRow({ label, value, onChange, options, disabled = false }: { label: string; value: string; onChange: (value: string) => void; options: Array<string | { value: string; label: string }>; disabled?: boolean }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs uppercase tracking-[0.08em] text-text-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={`rounded-[14px] border border-white/8 px-3.5 py-3 text-text-primary shadow-[inset_0_1px_2px_rgba(0,0,0,0.18)] ${
          disabled ? 'cursor-not-allowed bg-gray-700/45 text-gray-500' : 'cursor-pointer bg-bg-input'
        }`}
      >
        {options.map((opt) => {
          const normalized = typeof opt === 'string' ? { value: opt, label: opt } : opt
          return <option key={normalized.value} value={normalized.value}>{normalized.label}</option>
        })}
      </select>
    </label>
  )
}

function ValueMetric({ label, valueText, tone = 'neutral' }: { label: string; valueText: string; tone?: 'neutral' | 'danger' }) {
  return (
    <div className={`rounded-[14px] border p-3 ${
      tone === 'danger' ? 'border-accent-red/22 bg-red-950/50' : 'border-white/8 bg-bg-card'
    }`}>
      <div className="text-xs uppercase tracking-[0.08em] text-text-muted">{label}</div>
      <div className={`mt-1.5 text-lg font-extrabold ${tone === 'danger' ? 'text-accent-red' : 'text-text-primary'}`}>{valueText}</div>
    </div>
  )
}

function PriceMetric({ label, value, tone = 'neutral' }: { label: string; value: number; tone?: 'neutral' | 'danger' }) {
  return (
    <div className={`rounded-[14px] border p-3 ${
      tone === 'danger' ? 'border-accent-red/22 bg-red-950/50' : 'border-white/8 bg-bg-card'
    }`}>
      <div className="text-xs uppercase tracking-[0.08em] text-text-muted">{label}</div>
      <div className={`mt-1.5 text-lg font-extrabold ${tone === 'danger' ? 'text-accent-red' : 'text-text-primary'}`}>${value.toFixed(2)}</div>
    </div>
  )
}
