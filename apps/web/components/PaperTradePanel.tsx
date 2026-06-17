"use client"

import { useEffect, useMemo, useState, useRef } from 'react'
import type React from 'react'
import { getContractInfo } from '../lib/api'
import {
  buildPresetSyncedTradeState,
  canPauseRobot,
  getRunnerStartBlockReasonAfterProbe,
  getTradeDirectionModeOptions,
  type TradeDirectionMode,
  validateStopLossAgainstLiquidation,
} from './runner-ui-utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'

const DEFAULT_ACCOUNT_EQUITY = 1000

type OpenMode = 'margin' | 'risk'
type RunMode = 'manual' | 'auto'

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
  onRunStrategyOnce?: (symbols?: Array<'BTC_USDT' | 'ETH_USDT'>, leverage?: number, tradeMode?: 'paper' | 'live', directionMode?: TradeDirectionMode, dryRun?: boolean) => Promise<unknown>
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
      symbols?: Array<'BTC_USDT' | 'ETH_USDT'> | null
      strategy_type?: 'classic' | 'turtle' | 'ict' | 'macd_trend'
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
  robotEnabled?: boolean
  tradeMode?: 'paper' | 'live'
  onTradeModeChange?: (mode: 'paper' | 'live') => void
  liveConnected?: boolean
  liveEquity?: number
  livePositions?: Array<{ symbol: string; side: 'long' | 'short'; leverage: number; size: number; entry_price: number; mark_price: number; unrealized_pnl: number }>
}

export default function PaperTradePanel({ onOpen, onMark, onClose, onReset, onRunStrategyOnce, accountEquity = DEFAULT_ACCOUNT_EQUITY, marketTickers, positions = [], selectedStrategySlotId, onSelectedStrategySlotChange, strategyPresets = [], onRobotRunningChange, robotRunning, onRobotStateChange, onStartRobot, onPauseRobot, robotEnabled = false, tradeMode = 'paper', onTradeModeChange, liveConnected = false, liveEquity = 0, livePositions = [] }: Props) {
  const [symbol, setSymbol] = useState<'BTC_USDT' | 'ETH_USDT'>('BTC_USDT')
  const [side, setSide] = useState<'long' | 'short'>('long')
  const [openMode] = useState<OpenMode>('risk')
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
  const [runMode, setRunMode] = useState<RunMode>('auto')
  const [isStartingRobot, setIsStartingRobot] = useState(false)
  const [isSubmittingOpen, setIsSubmittingOpen] = useState(false)
  const [isRobotRunning, setIsRobotRunning] = useState(false)
  const [robotFeedback, setRobotFeedback] = useState('')
  const [tradeActionFeedback, setTradeActionFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [isSubmittingMark, setIsSubmittingMark] = useState(false)
  const [isSubmittingClose, setIsSubmittingClose] = useState(false)
  const [selectedRobotSymbols, setSelectedRobotSymbols] = useState<Array<'BTC_USDT' | 'ETH_USDT'>>([])
  const [leverageOptions, setLeverageOptions] = useState<number[]>([])
  const [contractLeverageMax, setContractLeverageMax] = useState(100)
  const [directionMode, setDirectionMode] = useState<TradeDirectionMode>('auto')

  useEffect(() => {
    if (typeof robotRunning === 'boolean') {
      setIsRobotRunning(robotRunning)
    }
  }, [robotRunning])

  const robotActive = canPauseRobot({ robotRunning: isRobotRunning, robotEnabled })
  const pauseAvailable = robotActive

  const selectedPreset = useMemo(
    () => strategyPresets.find((item) => String(item.slotId) === selectedStrategySlot) || null,
    [selectedStrategySlot, strategyPresets],
  )
  const formatStrategyTypeLabel = (strategyType?: 'classic' | 'turtle' | 'ict' | 'macd_trend') => {
    if (strategyType === 'turtle') return '海龟策略'
    if (strategyType === 'ict') return 'ICT 三周期'
    if (strategyType === 'macd_trend') return 'MACD趋势'
    return '经典策略'
  }
  const activeSymbol = runMode === 'manual' ? symbol : selectedPreset?.config.symbol ?? symbol
  const selectedStrategySummary = useMemo(() => {
    if (!selectedPreset) return null
    return [
      formatStrategyTypeLabel(selectedPreset.config.strategy_type),
      `${selectedPreset.config.symbol}`,
      '实际杠杆以交易工作区选择为准',
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

  const prevSlotIdRef = useRef<number | null>(null)
  useEffect(() => {
    if (!selectedPreset || !syncWithStrategy) return
    // 只在切换策略槽位时同步参数，避免数据刷新覆盖用户手动选择
    if (prevSlotIdRef.current === selectedPreset.slotId) return
    prevSlotIdRef.current = selectedPreset.slotId
    const nextState = buildPresetSyncedTradeState({
      currentLeverage: leverage,
      presetConfig: selectedPreset.config,
    })
    setSymbol(nextState.symbol)
    setStopLossPct(nextState.stopLossPct)
    setTakeProfitPct(nextState.takeProfitPct)
    setRiskPerTradePct(nextState.riskPerTradePct)
    setFeeRate(nextState.feeRate)
    setSlippageRate(nextState.slippageRate)
  }, [leverage, selectedPreset, syncWithStrategy])

  useEffect(() => {
    if (!selectedPreset) return
    const presetSymbols = selectedPreset.config.symbols && selectedPreset.config.symbols.length > 0
      ? selectedPreset.config.symbols
      : [selectedPreset.config.symbol]
    setSelectedRobotSymbols(Array.from(new Set(presetSymbols)))
  }, [selectedPreset?.slotId])

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

  async function handleMarkPosition() {
    if (!selectedPosition || isSubmittingMark) return
    setIsSubmittingMark(true)
    setTradeActionFeedback(null)
    try {
      await onMark({ symbol, mark_price: markPrice, position_id: selectedPosition.position_id || undefined })
      setTradeActionFeedback({ type: 'success', message: '持仓标记价已更新。' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setTradeActionFeedback({ type: 'error', message: `更新标记价失败：${message}` })
    } finally {
      setIsSubmittingMark(false)
    }
  }

  async function handleOpenPosition() {
    if (isSubmittingOpen) return
    setIsSubmittingOpen(true)
    setTradeActionFeedback(null)
    try {
      await onOpen({
        symbol,
        side,
        price,
        leverage,
        allocated_margin: openMode === 'risk' && accountEquity > 0
          ? Math.min(activePreview.effectiveAllocatedMargin, accountEquity * 0.19)
          : activePreview.effectiveAllocatedMargin,
        stop_loss_price: openMode === 'margin' ? stopLossPrice : derivedStopLossPrice,
        qty: openMode === 'margin' && explicitQty > 0 ? explicitQty : undefined,
        risk_per_trade_pct: openMode === 'risk' ? riskPerTradePct : undefined,
        stop_loss_pct: openMode === 'risk' ? stopLossPct : undefined,
        take_profit_pct: takeProfitPct,
        fee_rate: feeRate,
        slippage_rate: slippageRate,
      })
      setTradeActionFeedback({ type: 'success', message: '模拟开仓已提交。' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setTradeActionFeedback({ type: 'error', message: `模拟开仓失败：${message}` })
    } finally {
      setIsSubmittingOpen(false)
    }
  }

  async function handleClosePosition() {
    if (!selectedPosition || isSubmittingClose) return
    setIsSubmittingClose(true)
    setTradeActionFeedback(null)
    try {
      await onClose({ symbol, price: closingPrice, position_id: selectedPosition.position_id || undefined })
      setTradeActionFeedback({ type: 'success', message: '模拟平仓已完成。' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setTradeActionFeedback({ type: 'error', message: `模拟平仓失败：${message}` })
    } finally {
      setIsSubmittingClose(false)
    }
  }

  return (
    <div className="grid gap-4">
      {/* 实盘/模拟 选择器 */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-2.5">
        <button
          type="button"
          onClick={() => onTradeModeChange?.('live')}
          disabled={!liveConnected}
          className={`grid gap-1 p-3 rounded-2xl text-left cursor-pointer transition-all duration-200 shadow-[0_12px_24px_rgba(2,8,23,0.18)] ${
            tradeMode === 'live'
              ? 'bg-gradient-to-br from-[rgba(31,35,41,0.98)] to-[rgba(18,20,24,1)] text-white border border-white/12'
              : liveConnected
                ? 'bg-gradient-to-b from-[rgba(15,17,22,0.92)] to-[rgba(10,12,16,0.94)] text-text-primary border border-white/8'
                : 'bg-gradient-to-b from-[rgba(15,17,22,0.92)] to-[rgba(10,12,16,0.94)] text-text-muted border border-white/5 opacity-50 cursor-not-allowed'
          }`}
        >
          <div className="flex justify-between gap-2 items-center">
            <strong className="text-sm">实盘交易</strong>
            <Badge variant="secondary" className="bg-white/8 text-gray-200 px-2 py-1 text-[11px] font-extrabold rounded-full">
              {liveConnected ? 'LIVE' : '未连接'}
            </Badge>
          </div>
          <div className={`text-xs leading-relaxed mt-2 ${tradeMode === 'live' ? 'text-white/78' : 'text-text-muted'}`}>
            Gate.io 合约真实账户
          </div>
          <div className={`text-xs leading-relaxed mt-1 ${tradeMode === 'live' ? 'text-white/72' : 'text-text-muted'}`}>
            {liveConnected ? `权益 $${liveEquity.toFixed(2)} · ${livePositions.length} 持仓` : '请先在合约实盘账户中连接'}
          </div>
        </button>
        <button
          type="button"
          onClick={() => onTradeModeChange?.('paper')}
          className={`grid gap-1 p-3 rounded-2xl text-left cursor-pointer transition-all duration-200 shadow-[0_12px_24px_rgba(2,8,23,0.18)] ${
            tradeMode === 'paper'
              ? 'bg-gradient-to-br from-[rgba(31,35,41,0.98)] to-[rgba(18,20,24,1)] text-white border border-white/12'
              : 'bg-gradient-to-b from-[rgba(15,17,22,0.92)] to-[rgba(10,12,16,0.94)] text-text-primary border border-white/8'
          }`}
        >
          <div className="flex justify-between gap-2 items-center">
            <strong className="text-sm">模拟交易</strong>
            <Badge variant="secondary" className="bg-white/8 text-gray-200 px-2 py-1 text-[11px] font-extrabold rounded-full">PAPER</Badge>
          </div>
          <div className={`text-xs leading-relaxed mt-2 ${tradeMode === 'paper' ? 'text-white/78' : 'text-text-muted'}`}>
            模拟纸面交易，无真实资金
          </div>
          <div className={`text-xs leading-relaxed mt-1 ${tradeMode === 'paper' ? 'text-white/72' : 'text-text-muted'}`}>
            权益 ${accountEquity.toFixed(2)} · 策略驱动
          </div>
        </button>
        {onReset ? (
          <Button
            variant="outline"
            onClick={async () => {
              if (!window.confirm('确定要清除模拟历史并重置为 1000 USDT 吗？')) return
              try {
                await onReset(1000)
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err)
                alert(`重置失败：${msg}`)
              }
            }}
            className="w-full p-3 rounded-2xl border border-white/8 bg-white/4 text-text-secondary text-xs font-bold cursor-pointer"
          >
            清除历史 · 重置 1000
          </Button>
        ) : null}
      </div>

      <div className="rounded-3xl p-5 bg-gradient-to-br from-[#121418] via-[#1a1d22] to-[#23272d] shadow-[0_14px_28px_rgba(0,0,0,0.16)] grid gap-[18px]">
        <div>
          <div className="text-[11px] text-text-secondary uppercase tracking-[0.08em]">{tradeMode === 'live' ? 'Live Trading Console' : 'Paper Trading Console'}</div>
          <h3 className="mt-1.5 text-2xl tracking-[-0.03em] text-[#f8fafc]">{tradeMode === 'live' ? '实盘交易执行台' : '模拟交易执行台'}</h3>
          <p className="mt-2.5 text-text-secondary text-[13px] leading-relaxed">
            {tradeMode === 'live' ? '连接真实 Gate.io 合约账户，策略自动执行真实交易。' : '只保留"选策略 → 按策略运行机器人"。开仓价、止盈止损、风险比例等参数统一以策略配置为准。'}
          </p>
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
          <HeroStat label="账户权益" value={`$${(tradeMode === 'live' ? liveEquity : accountEquity).toFixed(2)}`} />
          <HeroStat label="当前模式" value={tradeMode === 'live' ? '实盘模式' : openMode === 'margin' ? '保证金模式' : '风险模式'} />
          <HeroStat label="预估名义价值" value={`$${activePreview.notional.toFixed(2)}`} />
          <HeroStat label="实时点位" value={liveTicker ? `$${liveTicker.last_price.toFixed(2)}` : '未连接'} />
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(320px,0.9fr)] gap-4 items-start">
        <div className="grid gap-4">
          <div className="border border-white/8 rounded-[22px] bg-gradient-to-b from-[rgba(15,17,22,0.94)] to-[rgba(10,12,16,0.96)] shadow-[0_10px_24px_rgba(0,0,0,0.14)] p-[18px]">
            <div className="flex justify-between gap-3 flex-wrap items-center mb-[14px]">
              <div>
                <div className="text-[11px] text-text-secondary uppercase tracking-[0.08em]">Trade Setup</div>
                <h4 className="mt-1.5 text-lg font-extrabold tracking-[-0.02em] text-[#f8fafc]">策略运行</h4>
              </div>
              <div className="flex gap-2 flex-wrap">
                <ModeChip active>按策略自动参数</ModeChip>
              </div>
            </div>

            <div className="grid gap-3">
              {strategyPresets.length > 0 ? (
                <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-2.5">
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
                        className={`grid gap-1 p-3 rounded-2xl text-left cursor-pointer transition-all duration-200 ${
                          active
                            ? 'bg-gradient-to-br from-[rgba(15,23,42,0.98)] to-[rgba(37,99,235,0.96)] text-white border border-blue-400/40 shadow-[0_8px_18px_rgba(0,0,0,0.14)]'
                            : 'bg-gradient-to-b from-[rgba(15,23,42,0.92)] to-[rgba(2,6,23,0.94)] text-text-primary border border-slate-700/78 shadow-[0_8px_18px_rgba(0,0,0,0.12)]'
                        }`}
                      >
                        <div className="flex justify-between gap-2 items-center">
                          <strong className="text-sm">{item.name}</strong>
                          <Badge variant="secondary" className={`px-2 py-1 text-[11px] font-extrabold rounded-full ${active ? 'bg-white/16 text-blue-100' : 'bg-sky-500/14 text-sky-200'}`}>
                            #{item.slotId}
                          </Badge>
                        </div>
                        <div className={`text-xs leading-relaxed mt-2 ${active ? 'text-white/78' : 'text-slate-300'}`}>
                          {formatStrategyTypeLabel(item.config.strategy_type)} · {item.config.symbol}
                        </div>
                        <div className={`text-[11px] leading-snug mt-0.5 ${active ? 'text-white/62' : 'text-slate-500'}`}>
                          实际杠杆以交易工作区选择为准
                        </div>
                        <div className={`text-xs leading-relaxed mt-1 ${active ? 'text-white/72' : 'text-slate-400'}`}>
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
              <div className="rounded-[18px] p-4 bg-gradient-to-br from-[rgba(15,17,22,0.9)] to-[rgba(24,27,32,0.96)] border border-white/8 shadow-[0_8px_18px_rgba(0,0,0,0.12)]">
                <div className="flex justify-between gap-3 items-center flex-wrap">
                  <div>
                    <div className="text-[11px] text-text-secondary uppercase tracking-[0.08em]">已选策略</div>
                    <h4 className="mt-1 text-lg font-extrabold tracking-[-0.02em] text-[#f8fafc]">当前已选：{selectedPreset.name}（策略 {selectedPreset.slotId}）</h4>
                  </div>
                  <div className="flex gap-2 items-center flex-wrap">
                    <Badge variant="secondary" className="px-3 py-2 bg-white/6 text-gray-200 text-xs font-extrabold rounded-full">关键字段已锁定</Badge>
                  </div>
                </div>
                <div className="mt-2.5 text-[13px] text-text-primary leading-relaxed">
                  {selectedStrategySummary}
                </div>
                <div className="mt-2.5 text-xs text-slate-400">
                  名称：{selectedPreset.name} ｜ 手续费率 {selectedPreset.config.fee_rate} ｜ 滑点率 {selectedPreset.config.slippage_rate}
                </div>
              </div>
            ) : null}

            {selectedPreset ? (
              <div className="text-xs text-text-muted bg-white/4 border border-white/6 rounded-xl p-2.5">
                已加载策略 {selectedPreset.slotId} · {selectedPreset.name} ｜ {formatStrategyTypeLabel(selectedPreset.config.strategy_type)} ｜ 实际杠杆以交易工作区选择为准
                {selectedPreset.config.strategy_type === 'turtle'
                  ? ` ｜ Entry ${selectedPreset.config.turtle_entry_period ?? '-'} ｜ Exit ${selectedPreset.config.turtle_exit_period ?? '-'} ｜ ATR ${selectedPreset.config.turtle_atr_period ?? '-'}`
                  : ` ｜ stop loss ${(selectedPreset.config.stop_loss_pct * 100).toFixed(2)}% ｜ risk ${(selectedPreset.config.risk_per_trade_pct * 100).toFixed(2)}%`}
              </div>
            ) : null}

            {runMode === 'manual' ? (
              <SelectField
                label="手动方向"
                value={side}
                onChange={(value) => setSide(value as 'long' | 'short')}
                options={[
                  { value: 'long', label: '做多' },
                  { value: 'short', label: '做空' },
                ]}
              />
            ) : (
              <SelectField label={'交易方向'} value={directionMode} onChange={(value) => setDirectionMode(value as TradeDirectionMode)} options={getTradeDirectionModeOptions()} />
            )}

            {tradeMode === 'live' && liveConnected && leverageOptions.length > 0 ? (
              <div className="flex gap-2 items-center flex-wrap">
                <span className="text-[13px] text-slate-400 min-w-20">实盘杠杆：</span>
                <div className="flex gap-1 flex-wrap">
                  {leverageOptions.map((lv) => (
                    <button
                      key={lv}
                      type="button"
                      onClick={() => setLeverage(lv)}
                      className={`px-2.5 py-1 rounded-md text-[13px] cursor-pointer transition-all ${
                        leverage === lv
                          ? 'border border-amber-500/60 bg-amber-500/15 text-amber-300 font-bold'
                          : 'border border-slate-700/80 bg-slate-900/60 text-slate-400'
                      }`}
                    >
                      {lv}x
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {liveTicker ? (
              <div className="text-xs text-text-muted bg-white/4 border border-white/6 rounded-xl p-2.5">实时最新价：{liveTicker.last_price.toFixed(2)} ｜ 实时标记价：{liveTicker.mark_price.toFixed(2)} ｜ 当前策略交易对：{activeSymbol}</div>
            ) : (
              <div className="text-xs text-amber-400 bg-white/4 border border-white/6 rounded-xl p-2.5">实时行情暂未连上，当前策略交易对：{activeSymbol}，当前仍可手动输入价格。</div>
            )}

            {symbolPositions.length > 0 ? (
              <div className="grid gap-2.5">
                <SelectField
                  label="操作目标仓位"
                  value={selectedPositionId}
                  onChange={setSelectedPositionId}
                  options={symbolPositions.map((item) => item.position_id || '').filter(Boolean)}
                />
                {selectedPosition ? (
                  <div className="text-xs text-text-muted bg-white/4 border border-white/6 rounded-xl p-2.5">
                    当前选中：{selectedPosition.side} ｜ qty {selectedPosition.qty.toFixed(6)} ｜ entry {selectedPosition.entry_price.toFixed(2)} ｜ mark {selectedPosition.mark_price.toFixed(2)}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="text-xs text-slate-400 bg-white/4 border border-white/6 rounded-xl p-2.5">当前交易对暂无持仓，标记/平仓按钮将按 symbol 提交但不会命中仓位。</div>
            )}

            <div className="grid gap-3">
              <div className="text-xs text-slate-400 font-bold">机器人交易对</div>
              <div className="flex gap-2.5 flex-wrap">
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
                      className={`rounded-2xl p-2.5 px-3 font-extrabold cursor-pointer transition-all ${
                        active
                          ? 'border border-sky-400/45 bg-gradient-to-br from-[rgba(8,47,73,0.96)] to-[rgba(29,78,216,0.92)] text-sky-100'
                          : 'border border-slate-600/70 bg-slate-900/72 text-slate-300'
                      }`}
                    >
                      {robotSymbol}
                    </button>
                  )
                })}
              </div>
              <div className="text-xs text-text-muted bg-white/4 border border-white/6 rounded-xl p-2.5">可多选任意组合。自动模式会按所选交易对依次执行一轮策略。</div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[13px] text-slate-400 mb-1.5">杠杆倍数</div>
                <div className="flex gap-1 flex-wrap">
                  {[1, 2, 3, 5, 10, 20, 25, 50, 75, 100].map((lv) => (
                    <button
                      key={lv}
                      type="button"
                      onClick={() => setLeverage(lv)}
                      className={`px-2.5 py-1 rounded-md text-[13px] cursor-pointer transition-all ${
                        leverage === lv
                          ? 'border border-amber-500/60 bg-amber-500/15 text-amber-300 font-bold'
                          : 'border border-slate-700/80 bg-slate-900/60 text-slate-400'
                      }`}
                    >
                      {lv}x
                    </button>
                  ))}
                </div>
              </div>
              <SelectField
                label="运行模式"
                value={runMode}
                onChange={(value) => setRunMode(value as RunMode)}
                options={[
                  { value: 'auto', label: '策略自动' },
                  { value: 'manual', label: '手动开仓' },
                ]}
              />
            </div>

            {runMode === 'manual' ? (
              <Button
                type="button"
                onClick={handleOpenPosition}
                disabled={isSubmittingOpen}
                className="w-full py-3 px-4 rounded-[14px] font-extrabold shadow-[0_8px_18px_rgba(0,0,0,0.14)] bg-gradient-to-br from-[#20232a] to-[#2b3038] text-white disabled:opacity-55 disabled:cursor-not-allowed"
              >
                {isSubmittingOpen ? '开仓中...' : '手动开仓'}
              </Button>
            ) : (
              <>
                <div className="text-xs text-text-muted bg-white/4 border border-white/6 rounded-xl p-2.5">
                  机器人会根据策略信号自动判断方向，参数统一取自所选策略配置。
                </div>

                <Button
                  onClick={async () => {
                    if (!selectedPreset || isStartingRobot) return
                    const stopLossGuard = validateStopLossAgainstLiquidation({
                      leverage,
                      stopLossPct: selectedPreset.config.stop_loss_pct,
                    })
                    if (!stopLossGuard.ok) {
                      setRobotFeedback(
                        `当前 ${leverage}x 杠杆下，估算强平缓冲仅 ${(stopLossGuard.liquidationBufferPct * 100).toFixed(2)}%，但止损为 ${(selectedPreset.config.stop_loss_pct * 100).toFixed(2)}%，会先强平后止损，请降低杠杆或缩小止损。`,
                      )
                      return
                    }
                    setIsStartingRobot(true)
                    setRobotFeedback('机器人启动中...')
                    try {
                      if (onRunStrategyOnce) {
                        const probeResult = await onRunStrategyOnce(selectedRobotSymbols, leverage, tradeMode, directionMode, true)
                        const blockReason = getRunnerStartBlockReasonAfterProbe(probeResult as any)
                        if (blockReason) {
                          setRobotFeedback(`启动已拦截：${blockReason}`)
                          return
                        }
                      }
                      await onStartRobot?.(selectedRobotSymbols)
                      setIsRobotRunning(true)
                      onRobotRunningChange?.(true)
                      onRobotStateChange?.({ running: true, symbol: selectedRobotSymbols[0] })
                      setRobotFeedback(`自动运行已启动（策略 ${selectedPreset.slotId} / ${selectedRobotSymbols.join(', ')}）`)
                    } catch (error) {
                      const message = error instanceof Error ? error.message : String(error)
                      setRobotFeedback(`启动失败：${message}`)
                    } finally {
                      setIsStartingRobot(false)
                    }
                  }}
                  disabled={!selectedPreset || isStartingRobot || robotActive}
                  className="w-full py-3 px-4 rounded-[14px] font-extrabold shadow-[0_8px_18px_rgba(0,0,0,0.14)] bg-gradient-to-br from-[#20232a] to-[#2b3038] text-white disabled:opacity-55 disabled:cursor-not-allowed"
                >
                  {!selectedPreset ? '请先选择策略' : isStartingRobot ? '启动中...' : robotActive ? '已启用自动轮询' : `${tradeMode === 'live' ? '实盘' : '模拟'}运行策略 ${selectedPreset.slotId}`}
                </Button>
              </>
            )}

            <Button
              type="button"
              onClick={async () => {
                try {
                  await onPauseRobot?.()
                  setIsRobotRunning(false)
                  onRobotRunningChange?.(false)
                  onRobotStateChange?.({ running: false })
                  setRobotFeedback('机器人已暂停')
                } catch (error) {
                  const message = error instanceof Error ? error.message : String(error)
                  setRobotFeedback(`暂停失败：${message}`)
                  return
                }
              }}
              disabled={!pauseAvailable || isStartingRobot}
              className="w-full py-3 px-4 rounded-[14px] font-extrabold bg-gradient-to-br from-slate-600 to-slate-700 text-white disabled:opacity-55 disabled:cursor-not-allowed mt-2.5"
            >
              暂停机器人
            </Button>

            {robotFeedback ? <div className="text-xs text-text-muted bg-white/4 border border-white/6 rounded-xl p-2.5">{robotFeedback}</div> : null}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <ActionPanel
              eyebrow="更新持仓标记"
              title="更新标记价"
              description="用于盯市和刷新浮盈亏。"
              accent="purple"
              control={<NumberField label="标记价" value={markPrice} onChange={setMarkPrice} />}
              button={
                <Button
                  variant="outline"
                  onClick={handleMarkPosition}
                  disabled={!selectedPosition || isSubmittingMark}
                  className="w-full py-3 px-4 rounded-[14px] font-extrabold bg-[#2b3038] text-white border-0 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {selectedPosition ? (isSubmittingMark ? '更新中...' : '更新标记价') : '暂无可更新持仓'}
                </Button>
              }
            />
            <ActionPanel
              eyebrow="模拟平仓"
              title="模拟平仓"
              description="录入平仓价格，生成最终 realized pnl。"
              accent="blue"
              control={<NumberField label="平仓价" value={closingPrice} onChange={setClosingPrice} />}
              button={
                <Button
                  variant="outline"
                  onClick={handleClosePosition}
                  disabled={!selectedPosition || isSubmittingClose}
                  className="w-full py-3 px-4 rounded-[14px] font-extrabold bg-[#2b3038] text-white border-0 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {selectedPosition ? (isSubmittingClose ? '平仓中...' : '模拟平仓') : '暂无可平仓持仓'}
                </Button>
              }
            />
          </div>
          {tradeActionFeedback ? (
            <div
              className={`mt-3 p-3 px-3.5 rounded-xl text-[13px] leading-relaxed ${
                tradeActionFeedback.type === 'success'
                  ? 'border border-green-500/28 bg-green-900/22 text-green-200'
                  : 'border border-red-400/28 bg-red-900/22 text-red-200'
              }`}
            >
              {tradeActionFeedback.message}
            </div>
          ) : null}
        </div>

        <div className="grid gap-4">
          <div className="border border-white/8 rounded-[22px] bg-gradient-to-b from-[rgba(15,17,22,0.94)] to-[rgba(10,12,16,0.96)] shadow-[0_10px_24px_rgba(0,0,0,0.14)] p-[18px] sticky top-3">
            <div className="text-[11px] text-text-secondary uppercase tracking-[0.08em]">风险预估</div>
            <h4 className="mt-1.5 text-lg font-extrabold tracking-[-0.02em] text-[#f8fafc]">实时风险预估</h4>
            <div className="grid gap-2.5 mt-3">
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

          <div className="border border-white/8 rounded-[22px] bg-gradient-to-b from-[rgba(15,17,22,0.94)] to-[rgba(10,12,16,0.96)] shadow-[0_10px_24px_rgba(0,0,0,0.14)] p-[18px] sticky top-3">
            <div className="text-[11px] text-text-secondary uppercase tracking-[0.08em]">操作提示</div>
            <h4 className="mt-1.5 text-lg font-extrabold tracking-[-0.02em] text-[#f8fafc]">操作提示</h4>
            <ul className="mt-3 pl-[18px] text-slate-300 text-[13px] leading-relaxed list-disc">
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
    <label className="grid gap-1.5">
      <span className="text-xs text-slate-400 font-semibold">{label}</span>
      <Input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        className={`p-2.5 px-3 rounded-xl border border-white/8 text-[#f8fafc] ${disabled ? 'opacity-65 cursor-not-allowed bg-slate-900/72' : 'bg-[rgba(2,6,23,0.88)]'}`}
      />
    </label>
  )
}

function SelectField({ label, value, onChange, options, disabled = false }: { label: string; value: string; onChange: (v: string) => void; options: Array<string | { value: string; label: string }>; disabled?: boolean }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs text-slate-400 font-semibold">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={`p-2.5 px-3 rounded-xl border border-white/8 text-[#f8fafc] text-sm ${disabled ? 'opacity-65 cursor-not-allowed bg-slate-900/72' : 'bg-[rgba(2,6,23,0.88)] cursor-pointer'}`}
      >
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
    <button
      className={`border-0 rounded-full px-3 py-2 font-bold cursor-default ${
        active
          ? 'bg-gradient-to-br from-[rgba(34,39,46,0.96)] to-[rgba(24,27,32,0.96)] text-gray-200'
          : 'bg-white/6 text-gray-200'
      }`}
    >
      {children}
    </button>
  )
}

function ActionPanel({ eyebrow, title, description, accent, control, button }: { eyebrow: string; title: string; description: string; accent: 'purple' | 'blue'; control: React.ReactNode; button: React.ReactNode }) {
  return (
    <div className="border border-white/8 rounded-[22px] bg-gradient-to-b from-[rgba(15,17,22,0.94)] to-[rgba(10,12,16,0.96)] shadow-[0_14px_32px_rgba(0,0,0,0.18)] p-[18px]">
      <div className="text-[11px] text-text-secondary uppercase tracking-[0.08em]">{eyebrow}</div>
      <h4 className="mt-1.5 text-lg font-extrabold tracking-[-0.02em] text-[#f8fafc]">{title}</h4>
      <div className="text-slate-400 text-[13px] leading-relaxed">{description}</div>
      <div className="mt-3">{control}</div>
      <div className="mt-3">{button}</div>
    </div>
  )
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 rounded-[16px] bg-white/5 border border-white/8">
      <div className="text-[11px] text-text-secondary uppercase tracking-[0.08em]">{label}</div>
      <div className="mt-2 text-lg font-extrabold text-[#f8fafc]">{value}</div>
    </div>
  )
}

function MetricCard({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'danger' }) {
  return (
    <div className={`p-3 rounded-[14px] ${
      tone === 'danger'
        ? 'bg-red-900/24 border border-red-400/28'
        : 'bg-slate-900/88 border border-slate-700/78'
    }`}>
      <div className="text-xs text-slate-400 font-semibold">{label}</div>
      <div className={`mt-1.5 text-base font-extrabold ${tone === 'danger' ? 'text-red-200' : 'text-[#f8fafc]'}`}>{value}</div>
    </div>
  )
}
