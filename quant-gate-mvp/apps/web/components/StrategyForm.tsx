"use client"

import { useEffect, useMemo, useState } from 'react'

import type { StrategyConfig, StrategyPriceReference } from './dashboard-types'
import { getStrategySnapshots, rollbackStrategy } from '../lib/api'

type Props = {
  initial: StrategyConfig
  onSave: (config: StrategyConfig, slotId?: number, name?: string) => Promise<void>
  onRunBacktest: (config: StrategyConfig, backtestDays: number) => Promise<void>
  priceReference?: StrategyPriceReference | null
  strategySlotId?: number
  strategySlotName?: string
  strategySlots?: Array<{
    slotId: number
    name?: string
    config: Pick<StrategyConfig, 'symbol' | 'timeframe' | 'strategy_type' | 'leverage' | 'stop_loss_pct' | 'take_profit_pct' | 'risk_per_trade_pct' | 'turtle_entry_period' | 'turtle_exit_period'> & Partial<Pick<StrategyConfig, 'turtle_atr_period' | 'turtle_atr_filter' | 'turtle_adx_period' | 'turtle_adx_threshold' | 'turtle_force_mode' | 'ict_bos_lookback' | 'ict_risk_reward' | 'fee_rate' | 'slippage_rate'>>
    locked?: boolean
  }>
  onStrategySlotChange?: (slotId: number) => void
  onStrategySlotNameChange?: (slotId: number, name: string) => void
  onAddStrategySlot?: (name?: string) => void
  onDeleteStrategySlot?: (slotId: number) => void
}

export default function StrategyForm({ initial, onSave, onRunBacktest, priceReference = null, strategySlotId = 1, strategySlotName = '', strategySlots = [], onStrategySlotChange, onStrategySlotNameChange, onAddStrategySlot, onDeleteStrategySlot }: Props) {
  const [form, setForm] = useState<StrategyConfig>(initial)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [backtestDays, setBacktestDays] = useState(7)
  const [backtestSymbol, setBacktestSymbol] = useState<'BTC_USDT' | 'ETH_USDT'>(initial.symbol)
  const [backtestLeverage, setBacktestLeverage] = useState(initial.leverage)
  const [backtestNotice, setBacktestNotice] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(true)
  const [saveNotice, setSaveNotice] = useState<string | null>(null)
  const [slotNameDraft, setSlotNameDraft] = useState(strategySlotName)
  const [snapshots, setSnapshots] = useState<Array<{ id: number; label: string | null; created_at: string }>>([])
  const [showSnapshots, setShowSnapshots] = useState(false)
  const [rollbackNotice, setRollbackNotice] = useState<string | null>(null)

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

  const strategyTypeLabel = form.strategy_type === 'turtle' ? '海龟策略' : form.strategy_type === 'ict' ? 'ICT三周期策略' : '经典策略'

  const signalSummary = useMemo(() => {
    if (form.strategy_type === 'turtle') {
      const adxPart = form.turtle_adx_threshold ? `, ADX>${form.turtle_adx_threshold}` : ''
      return `海龟(${form.turtle_entry_period}/${form.turtle_exit_period}, ATR ${form.turtle_atr_period}${adxPart})`
    }
    if (form.strategy_type === 'ict') {
      return `ICT(4h BOS ${form.ict_bos_lookback ?? 20} / 1h FVG / 15m 吞没, 1:${form.ict_risk_reward ?? 2.5})`
    }
    const enabled: string[] = []
    if (form.use_boll) enabled.push(`布林(${form.boll_period}, ${form.boll_std})`)
    if (form.use_rsi) enabled.push(`RSI(${form.rsi_period})`)
    if (form.use_ma) enabled.push(`EMA(${form.ma_short}/${form.ma_long})`)
    if (form.use_macd) enabled.push(`MACD(${form.macd_fast}/${form.macd_slow}/${form.macd_signal})`)
    if (form.use_kdj) enabled.push(`KDJ(${form.kdj_period}/${form.kdj_signal_period})`)
    enabled.push(`评分≥${form.min_signal_score ?? 3}`)
    enabled.push(form.churn_guard_enabled ? '防抖反手开启' : '防抖反手关闭')
    return enabled.length > 0 ? enabled.join(' ｜ ') : '未启用任何信号条件'
  }, [form])

  function update<K extends keyof StrategyConfig>(key: K, value: StrategyConfig[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

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

  async function handleRunBacktest(days = backtestDays) {
    setBacktestDays(days)
    setRunning(true)
    setBacktestNotice(null)
    try {
      await onRunBacktest({ ...form, symbol: backtestSymbol, leverage: backtestLeverage }, days)
      setBacktestNotice(`${days}天回测成功`)
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
    },
    locked: false,
  }))

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ display: 'grid', gap: 12, flex: 1, minWidth: 280 }}>
          <div style={sectionTitleStyle}>策略参数面板</div>
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>策略槽位</div>
            <div style={slotCardGridStyle}>
              {slotCards.map((slot) => {
                const active = slot.slotId === strategySlotId
                const locked = slot.locked ?? false
                return (
                  <button
                    key={slot.slotId}
                    type="button"
                    onClick={() => onStrategySlotChange?.(slot.slotId)}
                    style={{
                      ...slotCardStyle,
                      background: active ? 'linear-gradient(135deg, #0f172a 0%, #2563eb 100%)' : locked ? 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)' : 'rgba(255,255,255,0.96)',
                      color: active ? '#fff' : '#0f172a',
                      border: active ? '1px solid rgba(37,99,235,0.35)' : locked ? '1px solid rgba(245,158,11,0.35)' : '1px solid rgba(148,163,184,0.18)',
                      boxShadow: active ? '0 16px 32px rgba(37,99,235,0.18)' : locked ? '0 4px 12px rgba(245,158,11,0.15)' : 'none',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                      <strong style={{ fontSize: 14 }}>{slot.name || `策略 ${slot.slotId}`}</strong>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        {locked ? <span style={{ fontSize: 14 }}>🔒</span> : null}
                        <span style={{ ...slotPillStyle, background: active ? 'rgba(255,255,255,0.16)' : locked ? 'rgba(245,158,11,0.15)' : 'rgba(37,99,235,0.08)', color: active ? '#dbeafe' : locked ? '#92400e' : '#1d4ed8' }}>#{slot.slotId}</span>
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: active ? 'rgba(255,255,255,0.78)' : '#475569', lineHeight: 1.65, marginTop: 8 }}>
                      {slot.config.symbol} · {slot.config.timeframe} · {slot.config.leverage}x · {slot.config.strategy_type === 'turtle' ? '海龟' : slot.config.strategy_type === 'ict' ? 'ICT三周期' : '经典'}
                    </div>
                    <div style={{ fontSize: 12, color: active ? 'rgba(255,255,255,0.72)' : '#64748b', lineHeight: 1.65, marginTop: 4 }}>
                      SL {(slot.config.stop_loss_pct * 100).toFixed(2)}% ｜ TP {(slot.config.take_profit_pct * 100).toFixed(2)}% ｜ Risk {(slot.config.risk_per_trade_pct * 100).toFixed(2)}%
                    </div>
                    {slot.config.strategy_type === 'turtle' ? (
                      <div style={{ fontSize: 12, color: active ? 'rgba(255,255,255,0.72)' : '#64748b', lineHeight: 1.65, marginTop: 4 }}>
                        Entry {slot.config.turtle_entry_period} ｜ Exit {slot.config.turtle_exit_period} ｜ ATR {slot.config.turtle_atr_period ?? '-'} ｜ ATR Filter {slot.config.turtle_atr_filter ?? '-'}
                      </div>
                    ) : null}
                    {slot.config.strategy_type === 'turtle' ? (
                      <div style={{ fontSize: 12, color: active ? 'rgba(255,255,255,0.72)' : '#64748b', lineHeight: 1.65, marginTop: 4 }}>
                        ADX {slot.config.turtle_adx_period ?? '-'} ｜ Threshold {slot.config.turtle_adx_threshold ?? '-'} ｜ Mode {slot.config.turtle_force_mode || '-'} ｜ Fee {slot.config.fee_rate ?? '-'} ｜ Slippage {slot.config.slippage_rate ?? '-'}
                      </div>
                    ) : null}
                    {slot.config.strategy_type === 'ict' ? (
                      <div style={{ fontSize: 12, color: active ? 'rgba(255,255,255,0.72)' : '#64748b', lineHeight: 1.65, marginTop: 4 }}>
                        BOS {slot.config.ict_bos_lookback ?? 20} ｜ RR 1:{slot.config.ict_risk_reward ?? 2.5} ｜ 4h BOS + 1h FVG + 15m 吞没
                      </div>
                    ) : null}
                    {locked ? (
                      <div style={{ fontSize: 11, color: active ? 'rgba(255,255,255,0.65)' : '#92400e', lineHeight: 1.65, marginTop: 6, fontStyle: 'italic' }}>
                        🔒 优化参数已锁定
                      </div>
                    ) : null}
                  </button>
                )
              })}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={handleAddSlot} style={{ ...buttonStyle('linear-gradient(135deg, #2563eb 0%, #38bdf8 100%)'), padding: '10px 14px' }}>
              添加策略
            </button>
            <button type="button" onClick={handleDeleteSlot} disabled={strategySlots.length <= 1 || isLocked} style={{ ...buttonStyle('linear-gradient(135deg, #dc2626 0%, #ef4444 100%)'), padding: '10px 14px', opacity: strategySlots.length <= 1 || isLocked ? 0.55 : 1, cursor: strategySlots.length <= 1 || isLocked ? 'not-allowed' : 'pointer' }}>
              {isLocked ? '🔒 锁定策略' : '删除当前策略'}
            </button>
          </div>

          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: '#475569', flexWrap: 'wrap' }}>
            <span>保存策略名称</span>
            <input
              value={slotNameDraft}
              onChange={(e) => setSlotNameDraft(e.target.value)}
              onBlur={() => onStrategySlotNameChange?.(strategySlotId, slotNameDraft)}
              placeholder={`策略 ${strategySlotId}`}
              style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(148,163,184,0.28)', background: '#fff', minWidth: 220 }}
            />
          </label>
        </div>
        <button type="button" onClick={() => setCollapsed((prev) => !prev)} style={{ ...buttonStyle('rgba(15,23,42,0.08)'), color: '#0f172a', boxShadow: 'none' }}>
          {collapsed ? '展开参数' : '收起参数'}
        </button>
      </div>

      {saveNotice ? <div style={saveNoticeStyle}>{saveNotice}</div> : null}
      {backtestNotice ? <div style={{ ...saveNoticeStyle, background: 'linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%)', color: '#166534', border: '1px solid rgba(34,197,94,0.2)' }}>{backtestNotice}</div> : null}

      {isLocked ? (
        <div style={{
          padding: '12px 16px',
          borderRadius: 14,
          background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)',
          border: '1px solid rgba(245,158,11,0.35)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}>
          <span style={{ fontSize: 18 }}>🔒</span>
          <div>
            <div style={{ fontWeight: 800, color: '#92400e', fontSize: 13 }}>策略参数已锁定</div>
            <div style={{ fontSize: 12, color: '#a16207', marginTop: 2 }}>此策略使用优化后的15分钟海龟参数（ADX 35+趋势过滤），不允许修改或删除。如需自定义策略，请添加新策略槽。</div>
          </div>
        </div>
      ) : null}

      {collapsed ? (
        <div style={sectionStyle}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
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
              <div style={priceReferenceCardStyle}>
                <div style={{ fontSize: 13, color: '#059669', lineHeight: 1.7 }}>
                  ICT 策略的止损止盈由 1h FVG 边界和 1:{form.ict_risk_reward ?? 2.5} 风险回报比决定，执行时由后端实时计算。
                </div>
              </div>
            ) : (
              <div style={priceReferenceCardStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                  <div>
                    <div style={sectionTitleStyle}>实时参考价</div>
                    <div style={{ marginTop: 4, fontSize: 12, color: '#64748b' }}>
                      {priceReference.symbol} · {priceReference.timeframe} · 默认按 long 口径推导止损止盈
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: '#475569' }}>止损比例：{(priceReference.stop_loss_pct * 100).toFixed(2)}% · 止盈比例：{(priceReference.take_profit_pct * 100).toFixed(2)}%</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginTop: 12 }}>
                  <PriceMetric label="当前实时价" value={priceReference.live_price} />
                  <PriceMetric label="当前标记价" value={priceReference.mark_price} />
                  <PriceMetric label="默认 Entry" value={priceReference.default_entry_price} />
                  <PriceMetric label="推导 Stop Loss" value={priceReference.derived_stop_loss_price} tone="danger" />
                  <PriceMetric label="推导 Take Profit" value={priceReference.derived_take_profit_price} />
                </div>
              </div>
            )
          ) : null}

          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>信号参数</div>

            {form.strategy_type === 'turtle' ? (
              <div style={indicatorCardStyle}>
                <div style={{ display: 'grid', gap: 4 }}>
                  <strong style={{ fontSize: 14, color: '#0f172a' }}>海龟策略参数</strong>
                  <div style={{ fontSize: 12, color: '#64748b' }}>突破入场、回撤退出、ATR 波动过滤。</div>
                  <div style={{ fontSize: 12, color: '#1d4ed8', background: 'rgba(37,99,235,0.08)', border: '1px solid rgba(37,99,235,0.12)', borderRadius: 10, padding: '8px 10px' }}>
                    当前已切换为海龟策略，经典指标参数不会参与本次信号计算。
                  </div>
                </div>
                <div style={indicatorFieldsGridStyle}>
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
              <div style={indicatorCardStyle}>
                <div style={{ display: 'grid', gap: 4 }}>
                  <strong style={{ fontSize: 14, color: '#0f172a' }}>ICT 三周期策略参数</strong>
                  <div style={{ fontSize: 12, color: '#64748b' }}>4h BOS 趋势过滤 + 1h FVG 区域 + 15m 吞没入场。</div>
                  <div style={{ fontSize: 12, color: '#059669', background: 'rgba(5,150,105,0.08)', border: '1px solid rgba(5,150,105,0.12)', borderRadius: 10, padding: '8px 10px' }}>
                    ICT 策略自动拉取 4h / 1h / 15m 三组数据，止损止盈由 FVG 边界和风险回报比决定。
                  </div>
                </div>
                <div style={indicatorFieldsGridStyle}>
                  <FieldRow label="BOS 回看周期" type="number" value={form.ict_bos_lookback ?? 20} onChange={(v) => update('ict_bos_lookback' as any, Number(v))} disabled={isLocked} />
                  <FieldRow label="风险回报比" type="number" step="0.1" value={form.ict_risk_reward ?? 2.5} onChange={(v) => update('ict_risk_reward' as any, Number(v))} disabled={isLocked} />
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
                  <div style={indicatorFieldsGridStyle}>
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
                  <div style={indicatorFieldsGridStyle}>
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
                  <div style={indicatorFieldsGridStyle}>
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
                  <div style={indicatorFieldsGridStyle}>
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
                  <div style={indicatorFieldsGridStyle}>
                    <FieldRow label="KDJ 周期" type="number" value={form.kdj_period ?? 9} onChange={(v) => update('kdj_period', Number(v))} disabled={!(form.use_kdj ?? false)} />
                    <FieldRow label="KDJ 信号周期" type="number" value={form.kdj_signal_period ?? 3} onChange={(v) => update('kdj_signal_period', Number(v))} disabled={!(form.use_kdj ?? false)} />
                    <FieldRow label="KDJ 超卖" type="number" value={form.kdj_oversold ?? 20} onChange={(v) => update('kdj_oversold', Number(v))} disabled={!(form.use_kdj ?? false)} />
                    <FieldRow label="KDJ 超买" type="number" value={form.kdj_overbought ?? 80} onChange={(v) => update('kdj_overbought', Number(v))} disabled={!(form.use_kdj ?? false)} />
                  </div>
                </IndicatorToggleCard>

                <div style={indicatorCardStyle}>
                  <div style={{ display: 'grid', gap: 4 }}>
                    <strong style={{ fontSize: 14, color: '#0f172a' }}>评分触发阈值</strong>
                    <div style={{ fontSize: 12, color: '#64748b' }}>分数越低越容易触发，适合提升 15m 交易频率。</div>
                  </div>
                  <div style={indicatorFieldsGridStyle}>
                    <FieldRow label="最小信号分" type="number" value={form.min_signal_score ?? 3} onChange={(v) => update('min_signal_score', Number(v))} />
                  </div>
                </div>

                <IndicatorToggleCard
                  title="防频繁反手"
                  checked={form.churn_guard_enabled ?? false}
                  onToggle={(checked) => update('churn_guard_enabled', checked)}
                  hint="开启后，如果价格离当前持仓开仓价的波动还很小，就先拦截 reverse_signal，避免震荡里来回反手。"
                >
                  <div style={{ fontSize: 12, color: '#475569', lineHeight: 1.7 }}>
                    触发逻辑：当反向信号出现，但当前价格距离开仓价的波动仍低于一个小阈值时，Runner 会跳过这次反手。
                  </div>
                </IndicatorToggleCard>
              </>
            )}
          </div>

          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>风控参数</div>
            {!isLocked ? (
              <>
                <FieldRow label="止损比例" type="number" step="0.001" value={form.stop_loss_pct} onChange={(v) => update('stop_loss_pct', Number(v))} disabled={isLocked} />
                <FieldRow label="止盈比例" type="number" step="0.001" value={form.take_profit_pct} onChange={(v) => update('take_profit_pct', Number(v))} disabled={isLocked} />
                <FieldRow label="单笔风险比例" type="number" step="0.001" value={form.risk_per_trade_pct} onChange={(v) => update('risk_per_trade_pct', Number(v))} disabled={isLocked} />
              </>
            ) : (
              <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.7 }}>锁定策略不展示风控参数明细。</div>
            )}
          </div>
        </>
      ) : null}

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={handleSave} disabled={saving || isLocked} style={{
          ...buttonStyle(isLocked ? 'linear-gradient(135deg, #9ca3af 0%, #6b7280 100%)' : 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)'),
          cursor: isLocked ? 'not-allowed' : 'pointer',
        }}>
          {isLocked ? '🔒 策略已锁定' : saving ? '保存中...' : `保存策略 ${strategySlotId}`}
        </button>
        <button onClick={loadSnapshots} style={{
          ...buttonStyle('linear-gradient(135deg, #475569 0%, #64748b 100%)'),
          padding: '8px 14px',
          fontSize: 13,
        }}>
          历史版本
        </button>
        {rollbackNotice ? <span style={{ fontSize: 13, color: '#166534', fontWeight: 700 }}>{rollbackNotice}</span> : null}
        {showSnapshots && snapshots.length > 0 && (
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <select
              onChange={(e) => { const id = Number(e.target.value); if (id) handleRollback(id) }}
              defaultValue=""
              style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13, background: '#fff' }}
            >
              <option value="" disabled>选择版本回滚...</option>
              {snapshots.map(s => (
                <option key={s.id} value={s.id}>
                  #{s.id} {s.label || ''} {new Date(s.created_at).toLocaleString()}
                </option>
              ))}
            </select>
          </div>
        )}
        {showSnapshots && snapshots.length === 0 && (
          <span style={{ fontSize: 12, color: '#64748b' }}>暂无历史版本</span>
        )}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: '#475569', fontWeight: 700 }}>交易对</span>
          {(['BTC_USDT', 'ETH_USDT'] as const).map((sym) => (
            <button
              key={sym}
              type="button"
              onClick={() => setBacktestSymbol(sym)}
              style={{
                ...buttonStyle(backtestSymbol === sym ? 'linear-gradient(135deg, #059669 0%, #34d399 100%)' : 'rgba(15,23,42,0.08)'),
                color: backtestSymbol === sym ? '#fff' : '#0f172a',
                boxShadow: 'none',
                padding: '8px 14px',
                fontSize: 13,
              }}
            >
              {sym === 'BTC_USDT' ? 'BTC' : 'ETH'}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#475569', fontWeight: 700 }}>杠杆</span>
          <input
            type="number"
            min={10}
            max={150}
            step={5}
            value={backtestLeverage}
            onChange={(e) => setBacktestLeverage(Math.min(150, Math.max(10, Number(e.target.value) || 10)))}
            style={{
              width: 64,
              padding: '8px 6px',
              borderRadius: 8,
              border: '1px solid #cbd5e1',
              fontSize: 13,
              textAlign: 'center',
              background: '#f8fafc',
              color: '#0f172a',
            }}
          />
          <span style={{ fontSize: 13, color: '#64748b' }}>x</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: '#475569', fontWeight: 700 }}>回测周期</span>
          {[7, 15, 30].map((days) => (
            <button
              key={days}
              type="button"
              onClick={() => handleRunBacktest(days)}
              disabled={running}
              style={{
                ...buttonStyle(backtestDays === days ? 'linear-gradient(135deg, #2563eb 0%, #38bdf8 100%)' : 'rgba(15,23,42,0.08)'),
                color: backtestDays === days ? '#fff' : '#0f172a',
                boxShadow: 'none',
                padding: '10px 14px',
                opacity: running ? 0.7 : 1,
              }}
            >
              {running && backtestDays === days ? `${days}天回测中...` : `${days}天`}
            </button>
          ))}
          <button onClick={() => handleRunBacktest(backtestDays)} disabled={running} style={buttonStyle('linear-gradient(135deg, #2563eb 0%, #38bdf8 100%)')}>
            {running ? '回测中...' : `运行${backtestDays}天回测`}
          </button>
        </div>
      </div>
    </div>
  )
}

function IndicatorToggleCard({ title, checked, onToggle, hint, children }: { title: string; checked: boolean; onToggle: (checked: boolean) => void; hint: string; children: React.ReactNode }) {
  return (
    <div style={indicatorCardStyle}>
      <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, cursor: 'pointer', flexWrap: 'wrap' }}>
        <div style={{ display: 'grid', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input type="checkbox" checked={checked} onChange={(e) => onToggle(e.target.checked)} style={{ width: 18, height: 18 }} />
            <strong style={{ fontSize: 14, color: '#0f172a' }}>{title}</strong>
          </div>
          <div style={{ fontSize: 12, color: '#64748b' }}>{hint}</div>
        </div>
        <span style={{ ...toggleStatePillStyle, background: checked ? 'rgba(34,197,94,0.12)' : 'rgba(148,163,184,0.14)', color: checked ? '#15803d' : '#475569' }}>
          {checked ? '已启用' : '未启用'}
        </span>
      </label>
      <div style={{ opacity: checked ? 1 : 0.55 }}>{children}</div>
    </div>
  )
}

function FieldRow({ label, type = 'text', step, value, onChange, disabled = false }: { label: string; type?: string; step?: string; value: string | number; onChange: (value: string) => void; disabled?: boolean }) {
  return (
    <label style={{ display: 'grid', gap: 6 }}>
      <span style={{ fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</span>
      <input type={type} step={step} disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} style={{ padding: '12px 14px', borderRadius: 14, border: '1px solid rgba(148,163,184,0.28)', background: disabled ? 'rgba(226,232,240,0.45)' : '#fff', color: disabled ? '#94a3b8' : '#0f172a', boxShadow: 'inset 0 1px 2px rgba(15,23,42,0.03)' }} />
    </label>
  )
}

function SelectRow({ label, value, onChange, options, disabled = false }: { label: string; value: string; onChange: (value: string) => void; options: Array<string | { value: string; label: string }>; disabled?: boolean }) {
  return (
    <label style={{ display: 'grid', gap: 6 }}>
      <span style={{ fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} style={{ padding: '12px 14px', borderRadius: 14, border: '1px solid rgba(148,163,184,0.28)', background: disabled ? 'rgba(226,232,240,0.45)' : '#fff', color: disabled ? '#94a3b8' : '#0f172a', cursor: disabled ? 'not-allowed' : 'pointer' }}>
        {options.map((opt) => {
          const normalized = typeof opt === 'string' ? { value: opt, label: opt } : opt
          return <option key={normalized.value} value={normalized.value}>{normalized.label}</option>
        })}
      </select>
    </label>
  )
}

function buttonStyle(background: string): React.CSSProperties {
  return {
    padding: '12px 16px',
    borderRadius: 14,
    border: 0,
    background,
    color: '#fff',
    fontWeight: 800,
    cursor: 'pointer',
    boxShadow: '0 12px 24px rgba(15,23,42,0.14)',
  }
}

function ValueMetric({ label, valueText, tone = 'neutral' }: { label: string; valueText: string; tone?: 'neutral' | 'danger' }) {
  return (
    <div style={{
      padding: 12,
      borderRadius: 14,
      background: tone === 'danger' ? 'rgba(254,242,242,0.9)' : 'rgba(255,255,255,0.86)',
      border: tone === 'danger' ? '1px solid rgba(248,113,113,0.24)' : '1px solid rgba(148,163,184,0.18)',
    }}>
      <div style={{ fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
      <div style={{ marginTop: 6, fontSize: 18, fontWeight: 800, color: tone === 'danger' ? '#b91c1c' : '#0f172a' }}>{valueText}</div>
    </div>
  )
}

function PriceMetric({ label, value, tone = 'neutral' }: { label: string; value: number; tone?: 'neutral' | 'danger' }) {
  return (
    <div style={{
      padding: 12,
      borderRadius: 14,
      background: tone === 'danger' ? 'rgba(254,242,242,0.9)' : 'rgba(255,255,255,0.86)',
      border: tone === 'danger' ? '1px solid rgba(248,113,113,0.24)' : '1px solid rgba(148,163,184,0.18)',
    }}>
      <div style={{ fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
      <div style={{ marginTop: 6, fontSize: 18, fontWeight: 800, color: tone === 'danger' ? '#b91c1c' : '#0f172a' }}>${value.toFixed(2)}</div>
    </div>
  )
}

const slotCardGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 10,
}

const slotCardStyle: React.CSSProperties = {
  display: 'grid',
  gap: 4,
  padding: 12,
  borderRadius: 16,
  textAlign: 'left',
  cursor: 'pointer',
  transition: 'all 0.2s ease',
}

const slotPillStyle: React.CSSProperties = {
  padding: '4px 8px',
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 800,
}

const sectionStyle: React.CSSProperties = {
  display: 'grid',
  gap: 12,
  padding: 14,
  borderRadius: 18,
  background: 'rgba(248,250,252,0.9)',
  border: '1px solid rgba(148,163,184,0.16)',
}

const indicatorCardStyle: React.CSSProperties = {
  display: 'grid',
  gap: 12,
  padding: 12,
  borderRadius: 16,
  background: 'rgba(255,255,255,0.78)',
  border: '1px solid rgba(148,163,184,0.16)',
}

const indicatorFieldsGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 12,
}

const toggleStatePillStyle: React.CSSProperties = {
  padding: '4px 8px',
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 800,
}

const priceReferenceCardStyle: React.CSSProperties = {
  display: 'grid',
  gap: 10,
  padding: 14,
  borderRadius: 18,
  background: 'linear-gradient(180deg, rgba(239,246,255,0.9) 0%, rgba(248,250,252,0.96) 100%)',
  border: '1px solid rgba(96,165,250,0.24)',
}

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 800,
  color: '#0f172a',
}

const saveNoticeStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderRadius: 12,
  background: 'rgba(220,252,231,0.88)',
  border: '1px solid rgba(34,197,94,0.22)',
  color: '#166534',
  fontSize: 12,
  fontWeight: 700,
}
