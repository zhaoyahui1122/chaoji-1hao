import { useEffect, useMemo, useRef, useState } from 'react'

import {
  addStrategySlot,
  closeLivePosition,
  closePaperPosition,
  deleteStrategySlot,
  getDashboard,
  getEquityCurve,
  getHistoryStats,
  getMarketCandles,
  getMarketTicker,
  getOrderHistory,
  getPositionHistory,
  getRunnerLogs,
  getStrategy,
  getStrategySlots,
  placePaperOrder,
  resetPaperAccount,
  resumeRunner,
  runBacktest,
  runStrategyOnce,
  saveStrategy,
  toggleRunner,
  updatePaperMark,
  updateStrategySlotConfig,
  updateStrategySlotName,
} from '../lib/api'
import type {
  BacktestRequestPayload,
  PaperClosePayload,
  PaperMarkPayload,
  PaperTradePayload,
  RunnerRequestPayload,
} from '../lib/api'
import type {
  BacktestResult,
  BacktestRunSettings,
  DashboardData,
  EquityPoint,
  HistoryFilters,
  HistoryOrder,
  HistoryPosition,
  HistoryStats,
  RunnerInvocationResult,
  RunnerLogItem,
  StrategyConfig,
  StrategyPriceReference,
  StrategySlotPreset,
} from './dashboard-types'

const STRATEGY_SLOTS_STORAGE_KEY = 'quant-gate:strategy-slots'
const SELECTED_STRATEGY_SLOT_STORAGE_KEY = 'quant-gate:selected-strategy-slot'
const ACTIVE_MARKET_REFRESH_MS = 2000
const IDLE_MARKET_REFRESH_MS = 5000
const ACTIVE_ACTIVITY_REFRESH_MS = 5000
const IDLE_ACTIVITY_REFRESH_MS = 12000

const DEFAULT_HISTORY_FILTERS: HistoryFilters = {
  symbol: '',
  status: '',
  event_type: '',
  source: '',
  start_time: '',
  end_time: '',
  trade_mode: '',
}

export function useDashboardPageData() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [strategy, setStrategy] = useState<StrategyConfig | null>(null)
  const [backtest, setBacktest] = useState<BacktestResult | null>(null)
  const [runnerResult, setRunnerResult] = useState<RunnerInvocationResult | null>(null)
  const [runnerLogs, setRunnerLogs] = useState<RunnerLogItem[]>([])
  const [equityCurve, setEquityCurve] = useState<EquityPoint[]>([])
  const [orderHistory, setOrderHistory] = useState<HistoryOrder[]>([])
  const [positionHistory, setPositionHistory] = useState<HistoryPosition[]>([])
  const [historyStats, setHistoryStats] = useState<HistoryStats | null>(null)
  const [historyFilters, setHistoryFilters] = useState<HistoryFilters>(DEFAULT_HISTORY_FILTERS)
  const [marketTickers, setMarketTickers] = useState<Record<'BTC_USDT' | 'ETH_USDT', { last_price: number; mark_price: number } | null>>({
    BTC_USDT: null,
    ETH_USDT: null,
  })
  const [marketCandles, setMarketCandles] = useState<Record<'BTC_USDT' | 'ETH_USDT', { timestamp: number; volume: number; close: number; high: number; low: number; open: number }[]>>({
    BTC_USDT: [],
    ETH_USDT: [],
  })
  const [strategyPriceReference, setStrategyPriceReference] = useState<StrategyPriceReference | null>(null)
  const [strategyPresets, setStrategyPresets] = useState<StrategySlotPreset[]>([])
  const [selectedStrategySlotId, setSelectedStrategySlotId] = useState<number>(1)
  const [error, setError] = useState<string | null>(null)
  const historyFiltersRef = useRef(historyFilters)

  function buildHistoryQueryFilters() {
    const activeFilters = historyFiltersRef.current
    return {
      symbol: activeFilters.symbol || undefined,
      status: activeFilters.status || undefined,
      event_type: activeFilters.event_type || undefined,
      source: activeFilters.source || undefined,
      start_time: activeFilters.start_time || undefined,
      end_time: activeFilters.end_time || undefined,
      trade_mode: activeFilters.trade_mode || undefined,
    }
  }

  async function loadStrategyPresetsFromBackend(baseStrategy: StrategyConfig): Promise<StrategySlotPreset[]> {
    const fallback: StrategySlotPreset[] = [{ slotId: 1, name: '15分钟策略', config: baseStrategy, updatedAt: '', locked: false }]
    try {
      const data = await getStrategySlots()
      if (data.slots && data.slots.length > 0) {
        return data.slots.map((item) => ({
          slotId: item.slotId,
          name: item.name?.trim() || `策略 ${item.slotId}`,
          config: { ...baseStrategy, ...(item.config || {}) },
          updatedAt: item.updatedAt || '',
          locked: item.locked ?? false,
        }))
      }
      return fallback
    } catch {
      return fallback
    }
  }

  function persistLocalStrategyPresets(nextPresets: StrategySlotPreset[]) {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(STRATEGY_SLOTS_STORAGE_KEY, JSON.stringify(nextPresets))
  }

  function persistSelectedStrategySlot(slotId: number) {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(SELECTED_STRATEGY_SLOT_STORAGE_KEY, String(slotId))
  }

  function loadSelectedStrategySlot(defaultSlotId: number, availableSlotIds: number[]) {
    if (typeof window === 'undefined') return defaultSlotId
    const raw = window.localStorage.getItem(SELECTED_STRATEGY_SLOT_STORAGE_KEY)
    const parsed = Number(raw)
    return Number.isFinite(parsed) && availableSlotIds.includes(parsed) ? parsed : defaultSlotId
  }

  async function reloadDashboard() {
    const dashboardData = await getDashboard()
    setDashboard(dashboardData)
    // 自动同步历史筛选的 trade_mode
    const dashMode = dashboardData.trade_mode || ''
    setHistoryFilters((prev) => prev.trade_mode === dashMode ? prev : { ...prev, trade_mode: dashMode as any })
    return dashboardData
  }

  function buildStrategyPriceReference(
    strategyConfig: StrategyConfig | null,
    tickers: Record<'BTC_USDT' | 'ETH_USDT', { last_price: number; mark_price: number } | null>,
  ): StrategyPriceReference | null {
    if (!strategyConfig) return null
    const liveTicker = tickers[strategyConfig.symbol]
    const livePrice = liveTicker?.last_price ?? (strategyConfig.symbol === 'BTC_USDT' ? 64000 : 3200)
    // ICT 策略的止损止盈由 FVG 边界决定，不做百分比推导
    const isIct = strategyConfig.strategy_type === 'ict'
    const stopLossPrice = isIct ? 0
      : strategyConfig.symbol === 'BTC_USDT' || strategyConfig.symbol === 'ETH_USDT'
      ? livePrice * (1 - strategyConfig.stop_loss_pct)
      : livePrice
    const takeProfitPrice = isIct ? 0
      : strategyConfig.symbol === 'BTC_USDT' || strategyConfig.symbol === 'ETH_USDT'
      ? livePrice * (1 + strategyConfig.take_profit_pct)
      : livePrice
    return {
      symbol: strategyConfig.symbol,
      timeframe: strategyConfig.timeframe,
      live_price: livePrice,
      mark_price: liveTicker?.mark_price ?? livePrice,
      default_entry_price: livePrice,
      derived_stop_loss_price: stopLossPrice,
      derived_take_profit_price: takeProfitPrice,
      stop_loss_pct: isIct ? 0 : strategyConfig.stop_loss_pct,
      take_profit_pct: isIct ? 0 : strategyConfig.take_profit_pct,
    }
  }

  async function reloadMarketTickers(nextStrategy?: StrategyConfig | null) {
    const [btc, eth] = await Promise.all([
      getMarketTicker('BTC_USDT').catch(() => null),
      getMarketTicker('ETH_USDT').catch(() => null),
    ])
    const nextTickers = {
      BTC_USDT: btc ? { last_price: btc.last_price, mark_price: btc.mark_price } : null,
      ETH_USDT: eth ? { last_price: eth.last_price, mark_price: eth.mark_price } : null,
    }
    setMarketTickers(nextTickers)
    setStrategyPriceReference(buildStrategyPriceReference(nextStrategy ?? strategy, nextTickers))
  }

  async function reloadMarketCandles(symbol?: 'BTC_USDT' | 'ETH_USDT', timeframe?: '5m' | '15m' | '30m' | '1h' | '4h') {
    const activeSymbol = symbol || strategy?.symbol || 'BTC_USDT'
    const activeTimeframe = timeframe || strategy?.timeframe || '15m'
    const data = await getMarketCandles(activeSymbol, activeTimeframe, 120).catch(() => ({ items: [] }))
    setMarketCandles((prev) => ({
      ...prev,
      [activeSymbol]: data.items || [],
    }))
  }

  async function reloadRunnerLogs() {
    const data = await getRunnerLogs()
    setRunnerLogs(data.items || [])
    return data.items || []
  }

  async function reloadHistory() {
    const filters = buildHistoryQueryFilters()
    const [equityData, orderData, positionData, statsData] = await Promise.all([
      getEquityCurve(60, filters.trade_mode),
      getOrderHistory(100, filters),
      getPositionHistory(100, filters),
      getHistoryStats(filters.trade_mode),
    ])
    setEquityCurve(equityData.items || [])
    setOrderHistory(orderData.items || [])
    setPositionHistory(positionData.items || [])
    setHistoryStats(statsData)
    return {
      equity: equityData.items || [],
      orders: orderData.items || [],
      positions: positionData.items || [],
      stats: statsData,
    }
  }

  useEffect(() => {
    historyFiltersRef.current = historyFilters
  }, [historyFilters])

  // trade_mode 切换时立即重载历史数据，不等轮询间隔
  const prevTradeModeRef = useRef(historyFilters.trade_mode)
  useEffect(() => {
    if (prevTradeModeRef.current !== historyFilters.trade_mode) {
      prevTradeModeRef.current = historyFilters.trade_mode
      reloadHistory().catch(() => undefined)
    }
  }, [historyFilters.trade_mode])

  const isLiveUpdating = useMemo(() => {
    if (!dashboard) return false
    return Boolean(dashboard.runner?.enabled || dashboard.runner?.is_running || dashboard.account.open_positions > 0 || dashboard.positions.length > 0)
  }, [dashboard])

  useEffect(() => {
    async function load() {
      try {
        const filters = buildHistoryQueryFilters()
        const [dashboardData, strategyData, logsData, equityData, orderData, positionData, statsData, btcTicker, ethTicker] = await Promise.all([
          getDashboard(),
          getStrategy(),
          getRunnerLogs(),
          getEquityCurve(60, filters.trade_mode),
          getOrderHistory(100, filters),
          getPositionHistory(100, filters),
          getHistoryStats(filters.trade_mode),
          getMarketTicker('BTC_USDT').catch(() => null),
          getMarketTicker('ETH_USDT').catch(() => null),
        ])
        const nextTickers = {
          BTC_USDT: btcTicker ? { last_price: btcTicker.last_price, mark_price: btcTicker.mark_price } : null,
          ETH_USDT: ethTicker ? { last_price: ethTicker.last_price, mark_price: ethTicker.mark_price } : null,
        }
        const localPresets = await loadStrategyPresetsFromBackend(strategyData)
        const initialSlotId = localPresets[0]?.slotId || 1
        setDashboard(dashboardData)
        // 自动同步历史筛选的 trade_mode
        const dashMode = dashboardData.trade_mode || ''
        setHistoryFilters((prev) => prev.trade_mode === dashMode ? prev : { ...prev, trade_mode: dashMode as any })
        setStrategy(strategyData)
        setStrategyPresets(localPresets)
        setSelectedStrategySlotId(loadSelectedStrategySlot(initialSlotId, localPresets.map((item) => item.slotId)))
        persistLocalStrategyPresets(localPresets)
        persistSelectedStrategySlot(loadSelectedStrategySlot(initialSlotId, localPresets.map((item) => item.slotId)))
        setRunnerLogs(logsData.items || [])
        setEquityCurve(equityData.items || [])
        setOrderHistory(orderData.items || [])
        setPositionHistory(positionData.items || [])
        setHistoryStats(statsData)
        setMarketTickers(nextTickers)
        setStrategyPriceReference(buildStrategyPriceReference(strategyData, nextTickers))
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载失败')
      }
    }
    load()
  }, [historyFilters])

  useEffect(() => {
    const marketTimer = window.setInterval(() => {
      reloadDashboard().catch(() => undefined)
      reloadMarketTickers().catch(() => undefined)
    }, isLiveUpdating ? ACTIVE_MARKET_REFRESH_MS : IDLE_MARKET_REFRESH_MS)

    return () => window.clearInterval(marketTimer)
  }, [isLiveUpdating, strategy])

  useEffect(() => {
    const activityTimer = window.setInterval(() => {
      reloadRunnerLogs().catch(() => undefined)
      reloadHistory().catch(() => undefined)
    }, isLiveUpdating ? ACTIVE_ACTIVITY_REFRESH_MS : IDLE_ACTIVITY_REFRESH_MS)

    return () => window.clearInterval(activityTimer)
  }, [isLiveUpdating])

  const latestRunnerLog = useMemo(
    () => (runnerLogs && runnerLogs.length > 0 ? runnerLogs[runnerLogs.length - 1] : null),
    [runnerLogs],
  )

  const selectedStrategyPreset = useMemo(
    () => strategyPresets.find((item) => item.slotId === selectedStrategySlotId) || null,
    [strategyPresets, selectedStrategySlotId],
  )

  const latestClosedPosition = useMemo(
    () => positionHistory.find((item) => String(item.status || '').toLowerCase().includes('closed')) || positionHistory[0] || null,
    [positionHistory],
  )

  const recentOrders = useMemo(() => orderHistory.slice(0, 5), [orderHistory])

  async function handleSave(config: StrategyConfig, slotId = selectedStrategySlotId, name?: string) {
    const data = await saveStrategy(config)
    setStrategy(data)
    setStrategyPriceReference(buildStrategyPriceReference(data, marketTickers))
    setSelectedStrategySlotId(slotId)
    persistSelectedStrategySlot(slotId)
    // 同步到后端
    try {
      await updateStrategySlotConfig(slotId, config)
      if (name) await updateStrategySlotName(slotId, name)
    } catch (e) { console.warn('sync slot config failed:', e) }
    setStrategyPresets((prev) => {
      const existing = prev.find((item) => item.slotId === slotId)
      const next = prev.map((item) => item.slotId === slotId
        ? { slotId, name: name || item.name || `策略 ${slotId}`, config, updatedAt: new Date().toISOString() }
        : item,
      )
      if (!existing) {
        next.push({ slotId, name: name || `策略 ${slotId}`, config, updatedAt: new Date().toISOString() })
        next.sort((a, b) => a.slotId - b.slotId)
      }
      persistLocalStrategyPresets(next)
      return next
    })
  }

  function handleStrategySlotChange(slotId: number) {
    setSelectedStrategySlotId(slotId)
    persistSelectedStrategySlot(slotId)
  }

  async function handleRenameStrategySlot(slotId: number, name: string) {
    const normalized = name.trim() || `策略 ${slotId}`
    try {
      await updateStrategySlotName(slotId, normalized)
    } catch (e) { console.warn('sync rename failed:', e) }
    setStrategyPresets((prev) => {
      const next = prev.map((item) => item.slotId === slotId ? { ...item, name: normalized } : item)
      persistLocalStrategyPresets(next)
      return next
    })
  }

  async function handleDuplicateStrategySlot(sourceSlotId: number, targetSlotId: number, targetName?: string) {
    if (sourceSlotId === targetSlotId) return
    setStrategyPresets((prev) => {
      const source = prev.find((item) => item.slotId === sourceSlotId)
      if (!source) return prev
      const next = prev.map((item) => item.slotId === targetSlotId
        ? {
            ...item,
            name: (targetName?.trim() || `${source.name} 副本`),
            config: { ...source.config },
            updatedAt: new Date().toISOString(),
          }
        : item,
      )
      persistLocalStrategyPresets(next)
      return next
    })
    // 同步到后端
    try {
      const source = strategyPresets.find((item) => item.slotId === sourceSlotId)
      if (source) {
        await updateStrategySlotConfig(targetSlotId, source.config)
        await updateStrategySlotName(targetSlotId, targetName?.trim() || `${source.name} 副本`)
      }
    } catch (e) { console.warn('sync duplicate failed:', e) }
    setSelectedStrategySlotId(targetSlotId)
    persistSelectedStrategySlot(targetSlotId)
  }

  async function handleAddStrategySlot(name?: string) {
    // 先调后端创建
    let backendSlotId: number | undefined
    try {
      const res = await addStrategySlot(name)
      backendSlotId = res.slot?.slotId
    } catch (e) { console.warn('sync add slot failed:', e) }
    setStrategyPresets((prev) => {
      const nextSlotId = backendSlotId || (prev.length > 0 ? Math.max(...prev.map((item) => item.slotId)) + 1 : 1)
      const template = selectedStrategyPreset?.config || strategy
      if (!template) return prev
      const normalizedName = name?.trim() || `策略 ${nextSlotId}`
      const next = [...prev, {
        slotId: nextSlotId,
        name: normalizedName,
        config: { ...template },
        updatedAt: new Date().toISOString(),
      }]
      persistLocalStrategyPresets(next)
      setSelectedStrategySlotId(nextSlotId)
      persistSelectedStrategySlot(nextSlotId)
      return next
    })
  }

  async function handleDeleteStrategySlot(slotId: number) {
    const target = strategyPresets.find((item) => item.slotId === slotId)
    if (target?.locked) return
    // 先调后端删除
    try {
      await deleteStrategySlot(slotId)
    } catch (e) { console.warn('sync delete failed:', e) }
    setStrategyPresets((prev) => {
      if (prev.length <= 1) return prev
      const next = prev.filter((item) => item.slotId !== slotId)
      if (next.length === prev.length) return prev
      const fallbackSlotId = next[Math.max(0, next.findIndex((item) => item.slotId > slotId))]?.slotId || next[next.length - 1]?.slotId || 1
      persistLocalStrategyPresets(next)
      setSelectedStrategySlotId(fallbackSlotId)
      persistSelectedStrategySlot(fallbackSlotId)
      return next
    })
  }

  async function handleRunBacktest(config: StrategyConfig, options: BacktestRunSettings = { backtest_days: 7 }) {
    const liveTicker = marketTickers[config.symbol]
    const entryPrice = liveTicker?.last_price ?? (config.symbol === 'BTC_USDT' ? 64000 : 3200)
    const stopLossPrice = entryPrice * (1 - config.stop_loss_pct)

    const payload: BacktestRequestPayload = {
      ...config,
      data_source: 'gate',
      initial_balance: Number(dashboard?.defaults?.initial_balance || 10000),
      allocated_margin: Number(dashboard?.defaults?.default_allocated_margin || 1000),
      entry_price: entryPrice,
      stop_loss_price: stopLossPrice,
      backtest_days: options.backtest_days ?? 7,
    }

    if (options.start_date && options.end_date) {
      payload.start_date = options.start_date
      payload.end_date = options.end_date
    }

    const result = await runBacktest(payload)
    setBacktest(result)
  }

  function clearBacktest() {
    setBacktest(null)
  }

  async function handleRunStrategyOnce(symbols?: Array<'BTC_USDT' | 'ETH_USDT'>, overrideLeverage?: number, overrideTradeMode?: 'paper' | 'live', overrideDirectionMode?: 'auto' | 'long_only' | 'short_only') {
    const activeStrategy = selectedStrategyPreset?.config || strategy
    if (!activeStrategy) return
    const activeSymbols = symbols && symbols.length > 0 ? symbols : (activeStrategy.symbols && activeStrategy.symbols.length > 0 ? activeStrategy.symbols : [activeStrategy.symbol])
    const payload: RunnerRequestPayload = {
      symbol: activeSymbols[0],
      symbols: activeSymbols,
      timeframe: activeStrategy.timeframe,
      strategy_type: activeStrategy.strategy_type,
      data_source: 'gate',
      trade_mode: overrideTradeMode,
      direction_mode: overrideDirectionMode ?? 'auto',
      leverage: overrideLeverage ?? activeStrategy.leverage,
      allocated_margin: Number(dashboard?.defaults?.default_allocated_margin || 1000),
      use_boll: activeStrategy.use_boll,
      boll_period: activeStrategy.boll_period,
      boll_std: activeStrategy.boll_std,
      use_rsi: activeStrategy.use_rsi,
      rsi_period: activeStrategy.rsi_period,
      rsi_oversold: activeStrategy.rsi_oversold,
      rsi_overbought: activeStrategy.rsi_overbought,
      use_ma: activeStrategy.use_ma,
      ma_short: activeStrategy.ma_short,
      ma_long: activeStrategy.ma_long,
      use_macd: activeStrategy.use_macd,
      macd_fast: activeStrategy.macd_fast,
      macd_slow: activeStrategy.macd_slow,
      macd_signal: activeStrategy.macd_signal,
      use_kdj: activeStrategy.use_kdj,
      kdj_period: activeStrategy.kdj_period,
      kdj_signal_period: activeStrategy.kdj_signal_period,
      kdj_oversold: activeStrategy.kdj_oversold,
      kdj_overbought: activeStrategy.kdj_overbought,
      min_signal_score: activeStrategy.min_signal_score,
      churn_guard_enabled: activeStrategy.churn_guard_enabled,
      classic_trend_filter_enabled: activeStrategy.classic_trend_filter_enabled,
      classic_cooldown_bars: activeStrategy.classic_cooldown_bars,
      turtle_entry_period: activeStrategy.turtle_entry_period,
      turtle_exit_period: activeStrategy.turtle_exit_period,
      turtle_atr_period: activeStrategy.turtle_atr_period,
      turtle_atr_filter: activeStrategy.turtle_atr_filter,
      turtle_adx_period: (activeStrategy as any).turtle_adx_period,
      turtle_adx_threshold: (activeStrategy as any).turtle_adx_threshold,
      turtle_force_mode: (activeStrategy as any).turtle_force_mode,
      stop_loss_pct: activeStrategy.stop_loss_pct,
      take_profit_pct: activeStrategy.take_profit_pct,
      risk_per_trade_pct: activeStrategy.risk_per_trade_pct,
      fee_rate: activeStrategy.fee_rate,
      slippage_rate: activeStrategy.slippage_rate,
    }
    const result = await runStrategyOnce(payload)
    setRunnerResult(result)
    await Promise.all([
      reloadDashboard(),
      reloadMarketTickers(activeStrategy),
      reloadRunnerLogs(),
      reloadHistory(),
    ])
    return result
  }

  async function handleToggleRunner(enabled: boolean, symbols?: Array<'BTC_USDT' | 'ETH_USDT'>, tradeMode?: 'paper' | 'live') {
    await toggleRunner(enabled, symbols, tradeMode)
    await Promise.all([
      reloadDashboard(),
      reloadRunnerLogs(),
      reloadHistory(),
      reloadMarketTickers(),
    ])
  }

  async function handleResumeRunner() {
    await resumeRunner()
    await Promise.all([
      reloadDashboard(),
      reloadRunnerLogs(),
      reloadHistory(),
      reloadMarketTickers(),
    ])
  }

  async function handleOpenPaper(payload: PaperTradePayload) {
    await placePaperOrder(payload)
    await Promise.all([
      reloadDashboard(),
      reloadHistory(),
      reloadRunnerLogs(),
      reloadMarketTickers(strategy),
    ])
  }

  async function handleMarkPaper(payload: PaperMarkPayload) {
    await updatePaperMark(payload)
    await Promise.all([
      reloadDashboard(),
      reloadHistory(),
      reloadRunnerLogs(),
      reloadMarketTickers(strategy),
    ])
  }

  async function handleClosePaper(payload: PaperClosePayload) {
    if (dashboard?.trade_mode === 'live') {
      await closeLivePosition(payload.symbol, payload.position_id)
    } else {
      await closePaperPosition(payload)
    }
    await Promise.all([
      reloadDashboard(),
      reloadHistory(),
      reloadRunnerLogs(),
      reloadMarketTickers(strategy),
    ])
  }

  async function handleResetPaper(initialBalance: number) {
    await resetPaperAccount(initialBalance)
    await Promise.all([
      reloadDashboard(),
      reloadHistory(),
      reloadRunnerLogs(),
      reloadMarketTickers(strategy),
    ])
  }

  return {
    dashboard,
    strategy,
    backtest,
    runnerResult,
    runnerLogs,
    equityCurve,
    orderHistory,
    positionHistory,
    historyStats,
    historyFilters,
    setHistoryFilters,
    marketTickers,
    marketCandles,
    strategyPriceReference,
    strategyPresets,
    selectedStrategySlotId,
    selectedStrategyPreset,
    setSelectedStrategySlotId: handleStrategySlotChange,
    latestRunnerLog,
    latestClosedPosition,
    recentOrders,
    error,
    handleSave,
    handleRenameStrategySlot,
    handleDuplicateStrategySlot,
    handleAddStrategySlot,
    handleDeleteStrategySlot,
    handleRunBacktest,
    clearBacktest,
    handleRunStrategyOnce,
    handleToggleRunner,
    handleResumeRunner,
    handleOpenPaper,
    handleMarkPaper,
    handleClosePaper,
    handleResetPaper,
    reloadDashboard,
  }
}
