"use client"

import { useEffect, useMemo, useState } from 'react'
import type React from 'react'
import { getContractInfo } from '../lib/api'

const DEFAULT_ACCOUNT_EQUITY = 10000

type OpenMode = 'margin' | 'risk'

type OpenPayload = {
  symbol: 'BTC_USDT' | 'ETH_USDT'
  side: 'long' | 'short'
  price: number
  leverage: number
  allocated_margin: number
  stop_loss_price: number
  qty?: number
  risk_per_trade_pct?: number
  stop_loss_pct?: number
  take_profit_pct?: number
  fee_rate?: number
  slippage_rate?: number
}

type Props = {
  onOpen: (payload: OpenPayload) => Promise<void>
  onMark: (payload: { symbol: 'BTC_USDT' | 'ETH_USDT'; mark_price: number; position_id?: string }) => Promise<void>
  onClose: (payload: { symbol: 'BTC_USDT' | 'ETH_USDT'; price: number; position_id?: string }) => Promise<void>
  onReset?: (initialBalance: number) => Promise<void>
  onRunStrategyOnce?: (symbols?: Array<'BTC_USDT' | 'ETH_USDT'>) => Promise<void>
  accountEquity?: number
  marketTickers?: Record<'BTC_USDT' | 'ETH_USDT', { last_price: number; mark_price: number } | null>
  positions?: Array<{ position_id?: string | null; symbol: 'BTC_USDT' | 'ETH_USDT'; side: 'long' | 'short'; entry_price: number; mark_price: number; qty: number; leverage: number; unrealized_pnl?: number }>
  selectedStrategySlotId?: number
  onSelectedStrategySlotChange?: (slotId: number) => void
  strategyPresets?: Array<{
    slotId: number
    name: string
    config: {
      symbol: 'BTC_USDT' | 'ETH_USDT'
      strategy_type?: 'classic' | 'turtle' | 'ict'
      leverage: number
      stop_loss_pct: number
      take_profit_pct: number
      risk_per_trade_pct: number
      fee_rate: number
      slippage_rate: number
      turtle_entry_period?: number
      turtle_exit_period?: number
      turtle_atr_period?: number
    }
    locked?: boolean
  }>
  onRobotRunningChange?: (running: boolean) => void
  robotRunning?: boolean
  onRobotStateChange?: (state: { running: boolean; symbol?: 'BTC_USDT' | 'ETH_USDT' }) => void
  onStartRobot?: (symbols?: Array<'BTC_USDT' | 'ETH_USDT'>) => Promise<void>
  onPauseRobot?: () => Promise<void>
  tradeMode?: 'paper' | 'live'
  onTradeModeChange?: (mode: 'paper' | 'live') => void
  liveConnected?: boolean
  liveEquity?: number
  livePositions?: Array<{ symbol: string; side: 'long' | 'short'; leverage: number; size: number; entry_price: number; mark_price: number; unrealized_pnl: number }>
}

export default function PaperTradePanel({ onOpen, onMark, onClose, onReset, onRunStrategyOnce, accountEquity = DEFAULT_ACCOUNT_EQUITY, marketTickers, positions = [], selectedStrategySlotId, onSelectedStrategySlotChange, strategyPresets = [], onRobotRunningChange, robotRunning, onRobotStateChange, onStartRobot, onPauseRobot, tradeMode = 'paper', onTradeModeChange, liveConnected = false, liveEquity = 0, livePositions = [] }: Props) {
  const [symbol, setSymbol] = useState<'BTC_USDT' | 'ETH_USDT'>('BTC_USDT')
  const [side, setSide] = useState<'long' | 'short'>('long')
  const [openMode] = useState<OpenMode>('risk')
  const [runMode, setRunMode] = useState<'manual' | 'auto'>('auto')
  const [price, setPrice] = useState(64000)
  const [leverage, setLeverage] = useState(5)
  const [allocatedMargin, setAllocatedMargin] = useState(1000)
  const [stopLossPrice, setStopLossPrice] = useState(62720)
  const [riskPerTradePct, setRiskPerTradePct] = useState(0.01)
  const [stopLossPct, setStopLossPct] = useState(0.02)
  const [takeProfitPct, setTakeProfitPct] = useState(0.04)
  const [explicitQty, setExplicitQty] = useState(0)
  const [feeRate, setFeeRate] = useState(0.0005)
  const [slippageRate, setSlippageRate] = useState(0.0002)
  const [markPrice, setMarkPrice] = useState(64650)
  const [closingPrice, setClosingPrice] = useState(64650)
  const [selectedPositionId, setSelectedPositionId] = useState('')
  const [selectedStrategySlot, setSelectedStrategySlot] = useState('')
  const [syncWithStrategy] = useState(true)
  const [isStartingRobot, setIsStartingRobot] = useState(false)
  const [isRobotRunning, setIsRobotRunning] = useState(false)
  const [robotFeedback, setRobotFeedback] = useState('')
  const [selectedRobotSymbols, setSelectedRobotSymbols] = useState<Array<'BTC_USDT' | 'ETH_USDT'>>(['BTC_USDT', 'ETH_USDT'])
  const [leverageOptions, setLeverageOptions] = useState<number[]>([])
  const [contractLeverageMax, setContractLeverageMax] = useState(100)

  useEffect(() => {
    if (typeof robotRunning === 'boolean') {
      setIsRobotRunning(robotRunning)
    }
  }, [robotRunning])

  const selectedPreset = useMemo(
    () => strategyPresets.find((item) => String(item.slotId) === selectedStrategySlot) || null,
    [selectedStrategySlot, strategyPresets],
  )
  const activeSymbol = selectedPreset?.config.symbol ?? symbol
  const selectedStrategySummary = useMemo(() => {
    if (!selectedPreset) return null
    return [
      selectedPreset.config.strategy_type === 'turtle' ? '海龟策略' : '经典策略',
      `${selectedPreset.config.symbol}`,
      `${selectedPreset.config.leverage}x`,
      selectedPreset.config.strategy_type === 'turtle'
        ? `Entry ${selectedPreset.config.turtle_entry_period ?? '-'} / Exit ${selectedPreset.config.turtle_exit_period ?? '-'} / ATR ${selectedPreset.config.turtle_atr_period ?? '-'}`
        : `SL ${(selectedPreset.config.stop_loss_pct * 100).toFixed(2)}% / TP ${(selectedPreset.config.take_profit_pct * 100).toFixed(2)}% / Risk ${(selectedPreset.config.risk_per_trade_pct * 100).toFixed(2)}%`,
    ].join(' ｜ ')
  }, [selectedPreset])

  const liveTicker = marketTickers?.[activeSymbol] ?? null
  const symbolPositions = useMemo(() => positions.filter((item) => item.symbol === activeSymbol), [positions, activeSymbol])

  const derivedStopLossPrice = useMemo(() => {
    if (side === 'long') return price * (1 - stopLossPct)
    return price * (1 + stopLossPct)
  }, [price, side, stopLossPct])

  const derivedTakeProfitPrice = useMemo(() => {
    if (side === 'long') return price * (1 + takeProfitPct)
    return price * (1 - takeProfitPct)
  }, [price, side, takeProfitPct])

  const riskPreview = useMemo(() => {
    const stopDistance = Math.abs(price - derivedStopLossPrice)
    const riskCapital = accountEquity * riskPerTradePct
    const qty = stopDistance > 0 ? riskCapital / stopDistance : 0
    const notional = qty * price
    const riskBasedAllocatedMargin = leverage > 0 ? notional / leverage : 0
    const effectiveAllocatedMargin = riskBasedAllocatedMargin > 0 ? Math.min(allocatedMargin, riskBasedAllocatedMargin) : allocatedMargin
    const entryFee = notional * feeRate
    const entrySlippageCost = notional * slippageRate
    return {
      riskCapital,
      stopDistance,
      qty,
      notional,
      riskBasedAllocatedMargin,
      effectiveAllocatedMargin,
      entryFee,
      entrySlippageCost,
    }
  }, [accountEquity, allocatedMargin, derivedStopLossPrice, feeRate, leverage, price, riskPerTradePct, slippageRate])

  const marginPreview = useMemo(() => {
    const qty = explicitQty > 0 ? explicitQty : price > 0 ? (allocatedMargin * leverage) / price : 0
    const notional = qty * price
    const effectiveAllocatedMargin = leverage > 0 ? notional / leverage : 0
    const stopDistance = Math.abs(price - stopLossPrice)
    const maxLoss = qty * stopDistance
    const riskRatio = accountEquity > 0 ? maxLoss / accountEquity : 0
    const entryFee = notional * feeRate
    const entrySlippageCost = notional * slippageRate
    return {
      qty,
      notional,
      effectiveAllocatedMargin,
      stopDistance,
      maxLoss,
      riskRatio,
      entryFee,
      entrySlippageCost,
      usingExplicitQty: explicitQty > 0,
    }
  }, [accountEquity, allocatedMargin, explicitQty, feeRate, leverage, price, slippageRate, stopLossPrice])

  const activePreview = openMode === 'margin' ? marginPreview : riskPreview

  useEffect(() => {
    if (!liveTicker) return
    setPrice(liveTicker.last_price)
    setMarkPrice(liveTicker.mark_price)
    setClosingPrice(liveTicker.last_price)
    if (openMode === 'margin') {
      setStopLossPrice(side === 'long' ? liveTicker.last_price * 0.98 : liveTicker.last_price * 1.02)
    }
  }, [liveTicker, openMode, side])

  useEffect(() => {
    if (selectedStrategySlotId) {
      setSelectedStrategySlot(String(selectedStrategySlotId))
      return
    }
    if (!selectedStrategySlot && strategyPresets.length > 0) {
      setSelectedStrategySlot(String(strategyPresets[0].slotId))
    }
  }, [selectedStrategySlot, selectedStrategySlotId, strategyPresets])

  useEffect(() => {
    if (!selectedPreset || !syncWithStrategy) return
    setSymbol(selectedPreset.config.symbol)
    setLeverage(selectedPreset.config.leverage)
    setStopLossPct(selectedPreset.config.stop_loss_pct)
    setTakeProfitPct(selectedPreset.config.take_profit_pct)
    setRiskPerTradePct(selectedPreset.config.risk_per_trade_pct)
    setFeeRate(selectedPreset.config.fee_rate)
    setSlippageRate(selectedPreset.config.slippage_rate)
  }, [selectedPreset, syncWithStrategy])

  useEffect(() => {
    if (!selectedPreset) return
    setSelectedRobotSymbols((prev) => {
      if (prev.length > 0) return prev
      return ['BTC_USDT', 'ETH_USDT']
    })
  }, [selectedPreset])

  // 实盘模式下获取合约杠杆范围
  useEffect(() => {
    if (tradeMode !== 'live' || !liveConnected) {
      setLeverageOptions([])
      return
    }
    let cancelled = false
    async function loadContractInfo() {
      try {
        const info = await getContractInfo(activeSymbol)
        if (cancelled) return
        const max = Math.min(Number(info.leverage_max) || 100, 100)
        const min = Math.max(Number(info.leverage_min) || 1, 1)
        setContractLeverageMax(max)
        // 生成常用杠杆选项：1,2,3,5,10,20,25,50,75,100 中在 [min,max] 范围内的
        const presets = [1, 2, 3, 5, 10, 20, 25, 50, 75, 100]
        const opts = presets.filter(v => v >= min && v <= max)
        if (!opts.includes(max)) opts.push(max)
        setLeverageOptions(opts)
      } catch {
        if (!cancelled) {
          setLeverageOptions([1, 2, 3, 5, 10, 20, 25, 50, 75, 100])
          setContractLeverageMax(100)
        }
      }
    }
    loadContractInfo()
    return () => { cancelled = true }
  }, [tradeMode, liveConnected, activeSymbol])

  const selectedPosition = useMemo(
    () => symbolPositions.find((item) => item.position_id === selectedPositionId) || symbolPositions[0] || null,
    [selectedPositionId, symbolPositions],
  )

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* 实盘/模拟 选择器 */}
      <div style={slotCardGridStyle}>
        <button
          type="button"
          onClick={() => onTradeModeChange?.('live')}
          disabled={!liveConnected}
          style={{
            ...slotCardStyle,
            background: tradeMode === 'live' ? 'linear-gradient(135deg, rgba(15,23,42,0.98) 0%, rgba(6,95,70,0.92) 100%)' : 'linear-gradient(180deg, rgba(15,23,42,0.92) 0%, rgba(2,6,23,0.94) 100%)',
            color: tradeMode === 'live' ? '#fff' : liveConnected ? '#e2e8f0' : '#475569',
            border: tradeMode === 'live' ? '1px solid rgba(52,211,153,0.4)' : liveConnected ? '1px solid rgba(51,65,85,0.78)' : '1px solid rgba(51,65,85,0.4)',
            boxShadow: tradeMode === 'live' ? '0 16px 32px rgba(6,95,70,0.18)' : '0 12px 24px rgba(2,8,23,0.18)',
            opacity: liveConnected ? 1 : 0.5,
            cursor: liveConnected ? 'pointer' : 'not-allowed',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
            <strong style={{ fontSize: 14 }}>实盘交易</strong>
            <span style={{ ...slotPillStyle, background: tradeMode === 'live' ? 'rgba(255,255,255,0.16)' : liveConnected ? 'rgba(16,185,129,0.14)' : 'rgba(71,85,105,0.2)', color: tradeMode === 'live' ? '#d1fae5' : liveConnected ? '#a7f3d0' : '#64748b' }}>
              {liveConnected ? 'LIVE' : '未连接'}
            </span>
          </div>
          <div style={{ fontSize: 12, color: tradeMode === 'live' ? 'rgba(255,255,255,0.78)' : '#94a3b8', lineHeight: 1.65, marginTop: 8 }}>
            Gate.io 合约真实账户
          </div>
          <div style={{ fontSize: 12, color: tradeMode === 'live' ? 'rgba(255,255,255,0.72)' : '#64748b', lineHeight: 1.65, marginTop: 4 }}>
            {liveConnected ? `权益 $${liveEquity.toFixed(2)} · ${livePositions.length} 持仓` : '请先在合约实盘账户中连接'}
          </div>
        </button>
        <button
          type="button"
          onClick={() => onTradeModeChange?.('paper')}
          style={{
            ...slotCardStyle,
            background: tradeMode === 'paper' ? 'linear-gradient(135deg, rgba(15,23,42,0.98) 0%, rgba(37,99,235,0.96) 100%)' : 'linear-gradient(180deg, rgba(15,23,42,0.92) 0%, rgba(2,6,23,0.94) 100%)',
            color: tradeMode === 'paper' ? '#fff' : '#e2e8f0',
            border: tradeMode === 'paper' ? '1px solid rgba(96,165,250,0.4)' : '1px solid rgba(51,65,85,0.78)',
            boxShadow: tradeMode === 'paper' ? '0 16px 32px rgba(37,99,235,0.18)' : '0 12px 24px rgba(2,8,23,0.18)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
            <strong style={{ fontSize: 14 }}>模拟交易</strong>
            <span style={{ ...slotPillStyle, background: tradeMode === 'paper' ? 'rgba(255,255,255,0.16)' : 'rgba(14,165,233,0.14)', color: tradeMode === 'paper' ? '#dbeafe' : '#bae6fd' }}>PAPER</span>
          </div>
          <div style={{ fontSize: 12, color: tradeMode === 'paper' ? 'rgba(255,255,255,0.78)' : '#94a3b8', lineHeight: 1.65, marginTop: 8 }}>
            模拟纸面交易，无真实资金
          </div>
          <div style={{ fontSize: 12, color: tradeMode === 'paper' ? 'rgba(255,255,255,0.72)' : '#64748b', lineHeight: 1.65, marginTop: 4 }}>
            权益 ${accountEquity.toFixed(2)} · 策略驱动
          </div>
        </button>
        {onReset ? (
          <button
            type="button"
            onClick={async () => {
              if (!window.confirm('确定要清除模拟历史并重置为 1000 USDT 吗？')) return
              try {
                await onReset(1000)
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err)
                alert(`重置失败：${msg}`)
              }
            }}
            style={{
              padding: '8px 12px',
              borderRadius: 12,
              border: '1px solid rgba(239,68,68,0.35)',
              background: 'rgba(239,68,68,0.12)',
              color: '#fca5a5',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              width: '100%',
            }}
          >
            清除历史 · 重置 1000
          </button>
        ) : null}
      </div>

      <div style={heroCardStyle}>
        <div>
          <div style={eyebrowStyle}>{tradeMode === 'live' ? 'Live Trading Console' : 'Paper Trading Console'}</div>
          <h3 style={{ margin: '6px 0 0', fontSize: 24, letterSpacing: '-0.03em', color: '#f8fafc' }}>{tradeMode === 'live' ? '实盘交易执行台' : '模拟交易执行台'}</h3>
          <p style={{ margin: '10px 0 0', color: 'rgba(226,232,240,0.88)', fontSize: 13, lineHeight: 1.6 }}>
            {tradeMode === 'live' ? '连接真实 Gate.io 合约账户，策略自动执行真实交易。' : '只保留"选策略 → 按策略运行机器人"。开仓价、止盈止损、风险比例等参数统一以策略配置为准。'}
          </p>
        </div>
        <div style={heroStatsGridStyle}>
          <HeroStat label="账户权益" value={`$${(tradeMode === 'live' ? liveEquity : accountEquity).toFixed(2)}`} />
          <HeroStat label="当前模式" value={tradeMode === 'live' ? '实盘模式' : openMode === 'margin' ? '保证金模式' : '风险模式'} />
          <HeroStat label="预估名义价值" value={`$${activePreview.notional.toFixed(2)}`} />
          <HeroStat label="实时点位" value={liveTicker ? `$${liveTicker.last_price.toFixed(2)}` : '未连接'} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.5fr) minmax(320px, 0.9fr)', gap: 16, alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 16 }}>
          <div style={panelStyle}>
            <div style={panelHeaderStyle}>
              <div>
                <div style={panelEyebrowStyle}>Trade Setup</div>
                <h4 style={panelTitleStyle}>策略运行</h4>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <ModeChip active>按策略自动参数</ModeChip>
              </div>
            </div>

            <div style={{ display: 'grid', gap: 12 }}>
              {strategyPresets.length > 0 ? (
                <div style={slotCardGridStyle}>
                  {strategyPresets.map((item) => {
                    const active = String(item.slotId) === selectedStrategySlot
                    return (
                      <button
                        key={item.slotId}
                        type="button"
                        onClick={() => {
                          setSelectedStrategySlot(String(item.slotId))
                          onSelectedStrategySlotChange?.(item.slotId)
                        }}
                        style={{
                          ...slotCardStyle,
                          background: active ? 'linear-gradient(135deg, rgba(15,23,42,0.98) 0%, rgba(37,99,235,0.96) 100%)' : 'linear-gradient(180deg, rgba(15,23,42,0.92) 0%, rgba(2,6,23,0.94) 100%)',
                          color: active ? '#fff' : '#e2e8f0',
                          border: active ? '1px solid rgba(96,165,250,0.4)' : '1px solid rgba(51,65,85,0.78)',
                          boxShadow: active ? '0 16px 32px rgba(37,99,235,0.18)' : '0 12px 24px rgba(2,8,23,0.18)',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                          <strong style={{ fontSize: 14 }}>{item.name}</strong>
                          <span style={{ ...slotPillStyle, background: active ? 'rgba(255,255,255,0.16)' : 'rgba(14,165,233,0.14)', color: active ? '#dbeafe' : '#bae6fd' }}>#{item.slotId}</span>
                        </div>
                        <div style={{ fontSize: 12, color: active ? 'rgba(255,255,255,0.78)' : '#cbd5e1', lineHeight: 1.65, marginTop: 8 }}>
                          {(item.config.strategy_type === 'turtle' ? '海龟策略' : '经典策略')} · {item.config.symbol} · {item.config.leverage}x
                        </div>
                        <div style={{ fontSize: 12, color: active ? 'rgba(255,255,255,0.72)' : '#94a3b8', lineHeight: 1.65, marginTop: 4 }}>
                          {item.config.strategy_type === 'turtle'
                            ? `Entry ${item.config.turtle_entry_period ?? '-'} ｜ Exit ${item.config.turtle_exit_period ?? '-'} ｜ ATR ${item.config.turtle_atr_period ?? '-'}`
                            : `SL ${(item.config.stop_loss_pct * 100).toFixed(2)}% ｜ TP ${(item.config.take_profit_pct * 100).toFixed(2)}% ｜ Risk ${(item.config.risk_per_trade_pct * 100).toFixed(2)}%`}
                        </div>
                      </button>
                    )
                  })}
                </div>
              ) : null}

            </div>

            {selectedPreset ? (
              <div style={strategySummaryCardStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div>
                    <div style={panelEyebrowStyle}>Selected Strategy</div>
                    <h4 style={{ ...panelTitleStyle, marginTop: 4 }}>当前已选：{selectedPreset.name}（策略 {selectedPreset.slotId}）</h4>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={strategySlotBadgeStyle}>关键字段已锁定</div>
                  </div>
                </div>
                <div style={{ marginTop: 10, fontSize: 13, color: '#e2e8f0', lineHeight: 1.7 }}>
                  {selectedStrategySummary}
                </div>
                <div style={{ marginTop: 10, fontSize: 12, color: '#94a3b8' }}>
                  名称：{selectedPreset.name} ｜ 手续费率 {selectedPreset.config.fee_rate} ｜ 滑点率 {selectedPreset.config.slippage_rate}
                </div>
              </div>
            ) : null}

            {selectedPreset ? (
              <div style={hintStyle}>
                已加载策略 {selectedPreset.slotId} · {selectedPreset.name} ｜ {(selectedPreset.config.strategy_type === 'turtle' ? '海龟策略' : '经典策略')} ｜ leverage {selectedPreset.config.leverage}
                {selectedPreset.config.strategy_type === 'turtle'
                  ? ` ｜ Entry ${selectedPreset.config.turtle_entry_period ?? '-'} ｜ Exit ${selectedPreset.config.turtle_exit_period ?? '-'} ｜ ATR ${selectedPreset.config.turtle_atr_period ?? '-'}`
                  : ` ｜ stop loss ${(selectedPreset.config.stop_loss_pct * 100).toFixed(2)}% ｜ risk ${(selectedPreset.config.risk_per_trade_pct * 100).toFixed(2)}%`}
              </div>
            ) : null}

            {tradeMode === 'live' && liveConnected && leverageOptions.length > 0 ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, color: '#94a3b8', minWidth: 80 }}>实盘杠杆：</span>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {leverageOptions.map((lv) => (
                    <button
                      key={lv}
                      type="button"
                      onClick={() => setLeverage(lv)}
                      style={{
                        padding: '4px 10px',
                        borderRadius: 6,
                        border: `1px solid ${leverage === lv ? 'rgba(245,158,11,0.6)' : 'rgba(51,65,85,0.8)'}`,
                        background: leverage === lv ? 'rgba(245,158,11,0.15)' : 'rgba(15,23,42,0.6)',
                        color: leverage === lv ? '#fcd34d' : '#94a3b8',
                        fontSize: 13,
                        fontWeight: leverage === lv ? 700 : 400,
                        cursor: 'pointer',
                      }}
                    >
                      {lv}x
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {liveTicker ? (
              <div style={hintStyle}>实时最新价：{liveTicker.last_price.toFixed(2)} ｜ 实时标记价：{liveTicker.mark_price.toFixed(2)} ｜ 当前策略交易对：{activeSymbol}</div>
            ) : (
              <div style={{ ...hintStyle, color: '#fbbf24' }}>实时行情暂未连上，当前策略交易对：{activeSymbol}，当前仍可手动输入价格。</div>
            )}

            {symbolPositions.length > 0 ? (
              <div style={{ display: 'grid', gap: 10 }}>
                <SelectField
                  label="操作目标仓位"
                  value={selectedPositionId}
                  onChange={setSelectedPositionId}
                  options={symbolPositions.map((item) => item.position_id || '').filter(Boolean)}
                />
                {selectedPosition ? (
                  <div style={hintStyle}>
                    当前选中：{selectedPosition.side} ｜ qty {selectedPosition.qty.toFixed(6)} ｜ entry {selectedPosition.entry_price.toFixed(2)} ｜ mark {selectedPosition.mark_price.toFixed(2)}
                  </div>
                ) : null}
              </div>
            ) : (
              <div style={{ ...hintStyle, color: '#94a3b8' }}>当前交易对暂无持仓，标记/平仓按钮将按 symbol 提交但不会命中仓位。</div>
            )}

            <div style={{ display: 'grid', gap: 12 }}>
              <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 700 }}>机器人交易对</div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {(['BTC_USDT', 'ETH_USDT'] as const).map((robotSymbol) => {
                  const active = selectedRobotSymbols.includes(robotSymbol)
                  return (
                    <button
                      key={robotSymbol}
                      type="button"
                      onClick={() => {
                        setSelectedRobotSymbols((prev) => {
                          const exists = prev.includes(robotSymbol)
                          if (exists) {
                            const next = prev.filter((item) => item !== robotSymbol)
                            return next.length > 0 ? next : prev
                          }
                          return [...prev, robotSymbol]
                        })
                      }}
                      style={{
                        border: active ? '1px solid rgba(56,189,248,0.45)' : '1px solid rgba(71,85,105,0.7)',
                        background: active ? 'linear-gradient(135deg, rgba(8,47,73,0.96) 0%, rgba(29,78,216,0.92) 100%)' : 'rgba(15,23,42,0.72)',
                        color: active ? '#e0f2fe' : '#cbd5e1',
                        borderRadius: 12,
                        padding: '10px 12px',
                        fontWeight: 800,
                        cursor: 'pointer',
                      }}
                    >
                      {robotSymbol}
                    </button>
                  )
                })}
              </div>
              <div style={hintStyle}>可多选任意组合。自动模式会按所选交易对依次执行一轮策略。</div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 6 }}>杠杆倍数</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {[1, 2, 3, 5, 10, 20, 25, 50, 75, 100].map((lv) => (
                    <button
                      key={lv}
                      type="button"
                      onClick={() => setLeverage(lv)}
                      style={{
                        padding: '4px 10px',
                        borderRadius: 6,
                        border: `1px solid ${leverage === lv ? 'rgba(245,158,11,0.6)' : 'rgba(51,65,85,0.8)'}`,
                        background: leverage === lv ? 'rgba(245,158,11,0.15)' : 'rgba(15,23,42,0.6)',
                        color: leverage === lv ? '#fcd34d' : '#94a3b8',
                        fontSize: 13,
                        fontWeight: leverage === lv ? 700 : 400,
                        cursor: 'pointer',
                      }}
                    >
                      {lv}x
                    </button>
                  ))}
                </div>
              </div>
              <SelectField label="运行模式" value={runMode} onChange={(v) => setRunMode(v as 'manual' | 'auto')} options={[{ value: 'auto', label: '自动（策略信号）' }, { value: 'manual', label: '手动选方向' }]} />
            </div>

            {runMode === 'manual' ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <SelectField label="手动方向" value={side} onChange={(v) => setSide(v as 'long' | 'short')} options={['long', 'short']} />
                <div></div>
              </div>
            ) : null}

            <div style={hintStyle}>
              {runMode === 'auto'
                ? '自动模式：机器人根据策略信号自动判断方向（long/short），无需手动选择。'
                : '手动模式：手动选择方向后开仓。'}
              参数来源：策略配置（杠杆 / 止损 / 止盈 / 风险比例 / 手续费 / 滑点）。
            </div>

            <button
              onClick={async () => {
                if (!selectedPreset || isStartingRobot) return
                setIsStartingRobot(true)
                setRobotFeedback('机器人启动中...')
                try {
                  if (runMode === 'auto' && onRunStrategyOnce) {
                    await onRunStrategyOnce(selectedRobotSymbols)
                    await onStartRobot?.(selectedRobotSymbols)
                    setIsRobotRunning(true)
                    onRobotRunningChange?.(true)
                    onRobotStateChange?.({ running: true, symbol: selectedRobotSymbols[0] })
                    setRobotFeedback(`自动运行完成（策略 ${selectedPreset.slotId} / ${selectedRobotSymbols.join(', ')}）`)
                  } else {
                    // 手动模式：手动选择方向开仓
                    const runtimePrice = liveTicker?.last_price ?? price
                    const runtimeStopLoss = side === 'long'
                      ? runtimePrice * (1 - selectedPreset.config.stop_loss_pct)
                      : runtimePrice * (1 + selectedPreset.config.stop_loss_pct)
                    await onOpen({
                      symbol: selectedPreset.config.symbol,
                      side,
                      price: runtimePrice,
                      leverage,
                      allocated_margin: allocatedMargin,
                      stop_loss_price: runtimeStopLoss,
                      risk_per_trade_pct: selectedPreset.config.risk_per_trade_pct,
                      stop_loss_pct: selectedPreset.config.stop_loss_pct,
                      take_profit_pct: selectedPreset.config.take_profit_pct,
                      fee_rate: selectedPreset.config.fee_rate,
                      slippage_rate: selectedPreset.config.slippage_rate,
                    })
                    await onStartRobot?.()
                    setIsRobotRunning(true)
                    onRobotRunningChange?.(true)
                    onRobotStateChange?.({ running: true, symbol: selectedPreset.config.symbol })
                    setRobotFeedback(`已启动机器人（策略 ${selectedPreset.slotId}）`)
                  }
                } catch (error) {
                  const message = error instanceof Error ? error.message : String(error)
                  setRobotFeedback(`启动失败：${message}`)
                } finally {
                  setIsStartingRobot(false)
                }
              }}
              disabled={!selectedPreset || isStartingRobot}
              style={{ ...primaryButtonStyle, opacity: selectedPreset && !isStartingRobot ? 1 : 0.55, cursor: selectedPreset && !isStartingRobot ? 'pointer' : 'not-allowed' }}
            >
              {!selectedPreset ? '请先选择策略' : isStartingRobot ? '启动中...' : isRobotRunning ? '已启动机器人' : runMode === 'auto' ? `${tradeMode === 'live' ? '实盘' : '模拟'}运行策略 ${selectedPreset.slotId}` : `手动开仓（${side}）`}
            </button>

            <button
              type="button"
              onClick={async () => {
                setIsRobotRunning(false)
                onRobotRunningChange?.(false)
                onRobotStateChange?.({ running: false })
                try {
                  await onPauseRobot?.()
                } catch {}
                setRobotFeedback('机器人已暂停')
              }}
              disabled={!isRobotRunning || isStartingRobot}
              style={{
                ...primaryButtonStyle,
                background: 'linear-gradient(135deg, #475569 0%, #334155 100%)',
                opacity: isRobotRunning && !isStartingRobot ? 1 : 0.55,
                cursor: isRobotRunning && !isStartingRobot ? 'pointer' : 'not-allowed',
                marginTop: 10,
              }}
            >
              暂停机器人
            </button>

            {robotFeedback ? <div style={hintStyle}>{robotFeedback}</div> : null}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <ActionPanel
              eyebrow="Mark Position"
              title="更新标记价"
              description="用于盯市和刷新浮盈亏。"
              accent="purple"
              control={<NumberField label="标记价" value={markPrice} onChange={setMarkPrice} />}
              button={
                <button onClick={() => onMark({ symbol, mark_price: markPrice, position_id: selectedPosition?.position_id || undefined })} style={secondaryButtonStyle('#7c3aed')}>
                  更新标记价
                </button>
              }
            />
            <ActionPanel
              eyebrow="Close Position"
              title="模拟平仓"
              description="录入平仓价格，生成最终 realized pnl。"
              accent="blue"
              control={<NumberField label="平仓价" value={closingPrice} onChange={setClosingPrice} />}
              button={
                <button onClick={() => onClose({ symbol, price: closingPrice, position_id: selectedPosition?.position_id || undefined })} style={secondaryButtonStyle('#2563eb')}>
                  模拟平仓
                </button>
              }
            />
          </div>
        </div>

        <div style={{ display: 'grid', gap: 16 }}>
          <div style={sidePanelStyle}>
            <div style={panelEyebrowStyle}>Risk Preview</div>
            <h4 style={panelTitleStyle}>实时风险预估</h4>
            <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
              <MetricCard label="预估仓位" value={activePreview.qty.toFixed(6)} />
              <MetricCard label="预估名义价值" value={`$${activePreview.notional.toFixed(2)}`} />
              <MetricCard label="生效保证金" value={`$${activePreview.effectiveAllocatedMargin.toFixed(2)}`} />
              <MetricCard label="预估入场手续费" value={`$${activePreview.entryFee.toFixed(2)}`} />
              <MetricCard label="预估入场滑点成本" value={`$${activePreview.entrySlippageCost.toFixed(2)}`} />
              <MetricCard
                label={openMode === 'margin' ? '最大止损亏损' : '风险资金'}
                value={`$${(openMode === 'margin' ? marginPreview.maxLoss : riskPreview.riskCapital).toFixed(2)}`}
                tone="danger"
              />
            </div>
          </div>

          <div style={sidePanelStyle}>
            <div style={panelEyebrowStyle}>Execution Notes</div>
            <h4 style={panelTitleStyle}>操作提示</h4>
            <ul style={{ margin: '12px 0 0', paddingLeft: 18, color: '#cbd5e1', fontSize: 13, lineHeight: 1.7 }}>
              <li>先确认方向、价格、杠杆，再看预估名义价值和最大风险。</li>
              <li>风险模式下优先看风险资金、止损距离、推导仓位是否合理。</li>
              <li>保证金模式下如果填了显式数量，将覆盖保证金推导数量。</li>
              <li>开仓后用"更新标记价"做盯市，再用"模拟平仓"确认最终收益。</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}

function NumberField({ label, value, onChange, step, disabled = false }: { label: string; value: number; onChange: (v: number) => void; step?: number; disabled?: boolean }) {
  return (
    <label style={{ display: 'grid', gap: 6 }}>
      <span style={fieldLabelStyle}>{label}</span>
      <input type="number" step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} disabled={disabled} style={{ ...inputStyle, opacity: disabled ? 0.65 : 1, background: disabled ? 'rgba(15,23,42,0.72)' : 'rgba(2,6,23,0.88)', cursor: disabled ? 'not-allowed' : 'text' }} />
    </label>
  )
}

function SelectField({ label, value, onChange, options, disabled = false }: { label: string; value: string; onChange: (v: string) => void; options: Array<string | { value: string; label: string }>; disabled?: boolean }) {
  return (
    <label style={{ display: 'grid', gap: 6 }}>
      <span style={fieldLabelStyle}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} style={{ ...inputStyle, opacity: disabled ? 0.65 : 1, background: disabled ? 'rgba(15,23,42,0.72)' : 'rgba(2,6,23,0.88)', cursor: disabled ? 'not-allowed' : 'pointer' }}>
        {options.map((opt) => {
          const normalized = typeof opt === 'string' ? { value: opt, label: opt } : opt
          return <option key={normalized.value} value={normalized.value}>{normalized.label}</option>
        })}
      </select>
    </label>
  )
}

function ModeChip({ active = false, children }: { active?: boolean; children: React.ReactNode }) {
  return (
    <button style={{
      border: 0,
      borderRadius: 999,
      padding: '8px 12px',
      fontWeight: 700,
      cursor: 'default',
      background: active ? 'linear-gradient(135deg, rgba(30,41,59,0.96) 0%, rgba(29,78,216,0.88) 100%)' : 'rgba(15,23,42,0.58)',
      color: active ? '#f8fafc' : '#cbd5e1',
    }}>
      {children}
    </button>
  )
}

function ActionPanel({ eyebrow, title, description, accent, control, button }: { eyebrow: string; title: string; description: string; accent: 'purple' | 'blue'; control: React.ReactNode; button: React.ReactNode }) {
  return (
    <div style={{
      ...panelStyle,
      border: accent === 'purple' ? '1px solid rgba(124,58,237,0.28)' : '1px solid rgba(37,99,235,0.26)',
      boxShadow: accent === 'purple' ? '0 14px 32px rgba(76,29,149,0.22)' : '0 14px 32px rgba(30,64,175,0.2)',
    }}>
      <div style={panelEyebrowStyle}>{eyebrow}</div>
      <h4 style={panelTitleStyle}>{title}</h4>
      <div style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.6 }}>{description}</div>
      <div style={{ marginTop: 12 }}>{control}</div>
      <div style={{ marginTop: 12 }}>{button}</div>
    </div>
  )
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: 12, borderRadius: 16, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }}>
      <div style={{ fontSize: 11, color: 'rgba(226,232,240,0.74)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
      <div style={{ marginTop: 8, fontSize: 18, fontWeight: 800, color: '#f8fafc' }}>{value}</div>
    </div>
  )
}

function MetricCard({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'danger' }) {
  return (
    <div style={{
      padding: 12,
      borderRadius: 14,
      background: tone === 'danger' ? 'rgba(127,29,29,0.24)' : 'rgba(15,23,42,0.88)',
      border: tone === 'danger' ? '1px solid rgba(248,113,113,0.28)' : '1px solid rgba(51,65,85,0.78)',
    }}>
      <div style={fieldLabelStyle}>{label}</div>
      <div style={{ marginTop: 6, fontSize: 16, fontWeight: 800, color: tone === 'danger' ? '#fecaca' : '#f8fafc' }}>{value}</div>
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

const heroCardStyle: React.CSSProperties = {
  borderRadius: 24,
  padding: 20,
  background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 55%, #1d4ed8 100%)',
  boxShadow: '0 24px 48px rgba(15,23,42,0.18)',
  display: 'grid',
  gap: 18,
}

const heroStatsGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 12,
}

const panelStyle: React.CSSProperties = {
  border: '1px solid rgba(51,65,85,0.78)',
  borderRadius: 22,
  background: 'linear-gradient(180deg, rgba(15,23,42,0.94) 0%, rgba(2,6,23,0.96) 100%)',
  boxShadow: '0 16px 36px rgba(2,8,23,0.28)',
  padding: 18,
}

const sidePanelStyle: React.CSSProperties = {
  ...panelStyle,
  position: 'sticky',
  top: 12,
}

const panelHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  flexWrap: 'wrap',
  alignItems: 'center',
  marginBottom: 14,
}

const eyebrowStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'rgba(226,232,240,0.74)',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
}

const panelEyebrowStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#38bdf8',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
}

const panelTitleStyle: React.CSSProperties = {
  margin: '6px 0 0',
  fontSize: 18,
  fontWeight: 800,
  letterSpacing: '-0.02em',
  color: '#f8fafc',
}

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#94a3b8',
  fontWeight: 600,
}

const inputStyle: React.CSSProperties = {
  padding: '11px 12px',
  borderRadius: 12,
  border: '1px solid rgba(71,85,105,0.7)',
  background: 'rgba(2,6,23,0.88)',
  color: '#f8fafc',
}

const primaryButtonStyle: React.CSSProperties = {
  width: '100%',
  padding: '13px 16px',
  borderRadius: 14,
  border: 0,
  background: 'linear-gradient(135deg, #111827 0%, #1d4ed8 100%)',
  color: '#fff',
  fontWeight: 800,
  cursor: 'pointer',
  boxShadow: '0 14px 32px rgba(29,78,216,0.18)',
}

const strategySummaryCardStyle: React.CSSProperties = {
  borderRadius: 18,
  padding: 16,
  background: 'linear-gradient(135deg, rgba(15,23,42,0.9) 0%, rgba(30,41,59,0.96) 100%)',
  border: '1px solid rgba(59,130,246,0.24)',
  boxShadow: '0 14px 28px rgba(2,8,23,0.2)',
}

const strategySlotBadgeStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: 999,
  background: 'rgba(37,99,235,0.16)',
  color: '#bfdbfe',
  fontSize: 12,
  fontWeight: 800,
}

const syncSwitchStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  color: '#cbd5e1',
  fontWeight: 700,
}

function secondaryButtonStyle(background: string): React.CSSProperties {
  return {
    width: '100%',
    padding: '12px 16px',
    borderRadius: 14,
    border: 0,
    background,
    color: '#fff',
    fontWeight: 800,
    cursor: 'pointer',
  }
}

const hintStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#475569',
  background: 'rgba(15,23,42,0.72)',
  border: '1px solid rgba(51,65,85,0.7)',
  borderRadius: 12,
  padding: '10px 12px',
}
