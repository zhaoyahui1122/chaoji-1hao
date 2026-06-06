"use client"

import type { FormEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import AccountOverviewSection from '../components/AccountOverviewSection'
import BacktestRiskCard from '../components/BacktestRiskCard'
import BacktestSummaryCard from '../components/BacktestSummaryCard'
import BacktestTradesCard from '../components/BacktestTradesCard'
import { HeroMiniStat, MetricCard, SectionHeader } from '../components/DashboardShell'
import EquityCurveCard from '../components/EquityCurveCard'
import HistoryOverviewSection from '../components/HistoryOverviewSection'
import LiveAccountShell from '../components/LiveAccountShell'
import PaperTradePanel from '../components/PaperTradePanel'
import PositionHistoryCard from '../components/PositionHistoryCard'
import PositionsOverviewCard from '../components/PositionsOverviewCard'
import RunnerControlCard from '../components/RunnerControlCard'
import RunnerStatusCard from '../components/RunnerStatusCard'
import { chipStyle } from '../components/dashboard-types'
import {
  bannerStatGridStyle,
  bannerTextStyle,
  bannerTitleStyle,
  brandBadgeStyle,
  brandSubtleStyle,
  brandTitleStyle,
  brandWrapStyle,
  contentStyle,
  darkPanelStyle,
  eyebrowStyle,
  heroDescriptionStyle,
  heroPillStyle,
  heroRightGridStyle,
  heroStyle,
  heroTitleStyle,
  navButtonStyle,
  navDescStyle,
  navEyebrowStyle,
  navLabelStyle,
  navListStyle,
  navSectionStyle,
  navSectionTitleStyle,
  plainStateStyle,
  sectionStackStyle,
  shellGridStyle,
  shellStyle,
  sidebarStatStackStyle,
  sidebarStyle,
  rightRailStackStyle,
  strategyBannerStyle,
  twoColBalancedStyle,
  twoColWideStyle,
} from '../components/dashboard-layout-styles'
import { deriveTradingWorkspaceSnapshot } from '../components/dashboard-utils'
import { useDashboardPageData } from '../components/useDashboardPageData'
import {
  closeAllLivePositions,
  getLiveAccountStatus,
  getSession,
  login,
  logout,
  type LiveAccountStatus,
  type SessionResponse,
} from '../lib/api'

type WindowKey =
  | 'liveAccount'
  | 'positions'
  | 'strategy'
  | 'paper'
  | 'equity'
  | 'positionsHistory'

type TradeMode = 'paper' | 'live'

const WINDOW_OPTIONS: Array<{ key: WindowKey; label: string; description: string; eyebrow: string }> = [
  { key: 'liveAccount', label: '合约实盘账户', description: 'Gate 合约真实账户连接状态、总览与持仓', eyebrow: 'Live' },
  { key: 'positions', label: '持仓总览', description: '当前账户、仓位与市场参考', eyebrow: 'Overview' },
  { key: 'strategy', label: '策略控制台', description: '策略参数、回测、Runner 与风控总控', eyebrow: 'Strategy' },
  { key: 'paper', label: '交易', description: '实盘账户连接与纸面仓位模拟交易', eyebrow: 'Trade' },
  { key: 'equity', label: '权益曲线', description: '账户权益变化与回撤观察', eyebrow: 'Equity' },
  { key: 'positionsHistory', label: '持仓历史', description: '已结束持仓结果与执行摘要', eyebrow: 'History' },
]

function DashboardPageInner({ session, onLogout }: { session: SessionResponse; onLogout: () => Promise<void> }) {
  const {
    dashboard,
    strategy,
    backtest,
    runnerResult,
    equityCurve,
    positionHistory,
    historyStats,
    marketTickers,
    strategyPriceReference,
    strategyPresets,
    selectedStrategySlotId,
    setSelectedStrategySlotId,
    latestRunnerLog,
    latestClosedPosition,
    recentOrders,
    error,
    handleSave,
    handleRenameStrategySlot,
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
    setHistoryFilters,
  } = useDashboardPageData()

  const [activeWindow, setActiveWindow] = useState<WindowKey>('strategy')
  const [tradeMode, setTradeMode] = useState<TradeMode>('paper')
  const [liveAccountStatus, setLiveAccountStatus] = useState<LiveAccountStatus | null>(null)
  const livePollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const liveModeAutoSelectedRef = useRef(false)
  const [robotState, setRobotState] = useState<{
    running: boolean
    symbol?: 'BTC_USDT' | 'ETH_USDT'
    baselinePositionIds: string[]
  }>({ running: false, baselinePositionIds: [] })

  // Live account status polling
  const loadLiveStatus = useCallback(async () => {
    try {
      const data = await getLiveAccountStatus()
      setLiveAccountStatus(data)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    loadLiveStatus()
    livePollRef.current = setInterval(loadLiveStatus, 10_000)
    return () => { if (livePollRef.current) clearInterval(livePollRef.current) }
  }, [loadLiveStatus])

  const liveConnected = liveAccountStatus?.connected ?? false

  useEffect(() => {
    if (liveConnected && !liveModeAutoSelectedRef.current) {
      liveModeAutoSelectedRef.current = true
      setTradeMode('live')
    }
  }, [liveConnected])

  // 从后端同步机器人运行状态（刷新页面后恢复）
  useEffect(() => {
    if (dashboard?.runner?.is_running !== undefined) {
      setRobotState((prev) => ({
        ...prev,
        running: Boolean(dashboard.runner?.is_running),
      }))
    }
    // Runner 运行中时从后端状态同步 trade_mode（此时后端状态是权威来源）
    // Runner 未运行时保留用户手动选择
    if (dashboard?.runner?.is_running && dashboard?.runner?.trade_mode) {
      setTradeMode(dashboard.runner.trade_mode)
    }
  }, [dashboard?.runner?.is_running, dashboard?.runner?.trade_mode])

  // 同步 tradeMode 到历史记录筛选
  useEffect(() => {
    setHistoryFilters((prev) => ({ ...prev, trade_mode: tradeMode }))
  }, [tradeMode, setHistoryFilters])

  async function handleStartRobot(symbols?: Array<'BTC_USDT' | 'ETH_USDT'>) {
    const selectedSymbols: Array<'BTC_USDT' | 'ETH_USDT'> = symbols && symbols.length > 0
      ? symbols
      : dashboard?.runner?.selected_symbols && dashboard.runner.selected_symbols.length > 0
        ? dashboard.runner.selected_symbols
        : ['BTC_USDT', 'ETH_USDT']
    await handleToggleRunner(true, selectedSymbols, tradeMode)
  }

  async function handlePauseRobot() {
    await handleToggleRunner(false, undefined, tradeMode)
    setRobotState({ running: false, baselinePositionIds: [] })
  }

  async function handleCloseAll() {
    if (tradeMode === 'live') {
      await closeAllLivePositions()
    } else {
      for (const pos of effectivePositions) {
        await handleClosePaper({ symbol: pos.symbol as 'BTC_USDT' | 'ETH_USDT', price: pos.mark_price, position_id: pos.position_id ?? undefined })
      }
    }
    await reloadDashboard()
  }

  const positionsForOverview = useMemo(() => {
    const all = dashboard?.positions ?? []
    const bySymbol = robotState.symbol ? all.filter((item) => item.symbol === robotState.symbol) : all
    const baseline = new Set(robotState.baselinePositionIds)
    return robotState.running ? bySymbol.filter((item) => !baseline.has(item.position_id)) : []
  }, [dashboard?.positions, robotState])

  const tradingWorkspaceSnapshot = useMemo(
    () => dashboard
      ? deriveTradingWorkspaceSnapshot({
        dashboard,
        tradeMode,
        liveStatus: liveAccountStatus,
        marketTickers,
      })
      : null,
    [dashboard, liveAccountStatus, marketTickers, tradeMode],
  )
  const usernameLabel = session.username || 'admin'

  const effectiveAccount = tradingWorkspaceSnapshot?.account
  const effectivePositions = tradingWorkspaceSnapshot?.positions ?? []

  if (error) {
    return <main style={plainStateStyle}>加载失败：{error}</main>
  }

  if (!dashboard || !strategy || !effectiveAccount) {
    return <main style={plainStateStyle}>正在加载 Quant Gate 控制台...</main>
  }

  const activeWindowMeta = WINDOW_OPTIONS.find((item) => item.key === activeWindow) || WINDOW_OPTIONS[0]
  const selectedStrategyPreset = strategyPresets.find((item) => item.slotId === selectedStrategySlotId) || null
  const strategyType = selectedStrategyPreset?.config.strategy_type || strategy.strategy_type
  const overviewRiskConfig = {
    stopLossPct: selectedStrategyPreset?.config.stop_loss_pct ?? strategy.stop_loss_pct,
    takeProfitPct: selectedStrategyPreset?.config.take_profit_pct ?? strategy.take_profit_pct,
  }
  const heroMiniStats = [
    { label: '账户权益', value: `$${effectiveAccount.equity.toFixed(2)}` },
    { label: '可用余额', value: `$${effectiveAccount.available_balance.toFixed(2)}` },
    { label: '未实现盈亏', value: `$${effectiveAccount.unrealized_pnl.toFixed(2)}` },
    { label: '当前持仓数', value: `${effectivePositions.length}` },
  ]
  const runnerModeLabel = dashboard.runner?.enabled
    ? (tradeMode === 'live'
      ? (dashboard.runner?.is_running ? '实盘运行中' : '实盘已启用')
      : (dashboard.runner?.is_running ? '模拟运行中' : '模拟已启用'))
    : '未启动'

  return (
    <main style={shellStyle}>
      <div style={shellGridStyle}>
        <aside style={sidebarStyle}>
          <div style={brandWrapStyle}>
            <div style={brandBadgeStyle}>QG</div>
            <div>
              <div style={eyebrowStyle}>Trading Console</div>
              <h1 style={brandTitleStyle}>Quant Gate MVP</h1>
              <p style={brandSubtleStyle}>沿用现有量化链路，前端工作台向 3001 风格收口。</p>
            </div>
          </div>

          <div style={sidebarStatStackStyle}>
            <MetricCard label="账户权益" value={`$${effectiveAccount.equity.toFixed(2)}`} tone="cyan" />
            <MetricCard label="最大回撤" value={effectiveAccount.max_drawdown_pct != null ? `${(effectiveAccount.max_drawdown_pct * 100).toFixed(2)}%` : '-'} tone={(effectiveAccount.max_drawdown_pct ?? 0) > 0.1 ? 'amber' : 'slate'} />
            <MetricCard label="Runner" value={
              dashboard.runner?.enabled
                ? (tradeMode === 'live'
                  ? (dashboard.runner?.is_running ? '实盘运行中' : '实盘已启用')
                  : (dashboard.runner?.is_running ? '模拟运行中' : '模拟已启用'))
                : '未启动'
            } tone={
              dashboard.runner?.enabled
                ? (tradeMode === 'live' ? 'amber' : (dashboard.runner?.is_running ? 'green' : 'cyan'))
                : 'slate'
            } />
            <MetricCard label="策略" value={selectedStrategyPreset?.name || `策略 ${selectedStrategySlotId}`} tone="blue" />
          </div>

          <div style={navSectionStyle}>
            <div style={navSectionTitleStyle}>工作区</div>
            <div style={navListStyle}>
              {WINDOW_OPTIONS.map((item) => {
                const active = item.key === activeWindow
                const isLive = item.key === 'liveAccount'
                return (
                  <button
                    key={item.key}
                    onClick={() => setActiveWindow(item.key)}
                    style={{
                      ...navButtonStyle,
                      border: active ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(255,255,255,0.08)',
                      background: active ? 'linear-gradient(135deg, rgba(31,35,41,0.98) 0%, rgba(18,20,24,1) 100%)' : 'rgba(15,17,22,0.82)',
                      boxShadow: active ? 'inset 0 0 0 1px rgba(255,255,255,0.02), 0 8px 18px rgba(0,0,0,0.14)' : 'none',
                    }}
                  >
                    <div style={navEyebrowStyle}>{item.eyebrow}</div>
                    <div style={navLabelStyle}>{item.label}</div>
                    <div style={navDescStyle}>{item.description}</div>
                  </button>
                )
              })}
            </div>
          </div>
        </aside>

        <section style={contentStyle}>
          <section style={heroStyle}>
            <div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={heroPillStyle}>3001 风格控制台 / 深色工作台</div>
                <span style={chipStyle({ color: '#f8fafc', background: 'rgba(148,163,184,0.14)' })}>管理员：{usernameLabel}</span>
                <span style={chipStyle({ color: '#f3f4f6', background: 'rgba(255,255,255,0.06)' })}>
                  {tradeMode === 'live' ? 'LIVE' : 'PAPER'} / {runnerModeLabel}
                </span>
                <button
                  onClick={() => { void onLogout() }}
                  style={{
                    border: '1px solid rgba(255,255,255,0.08)',
                    background: 'rgba(255,255,255,0.04)',
                    color: '#e5e7eb',
                    borderRadius: 999,
                    padding: '8px 14px',
                    cursor: 'pointer',
                    fontSize: 13,
                  }}
                >
                  退出登录
                </button>
              </div>
              <h2 style={heroTitleStyle}>{activeWindowMeta.label}</h2>
              <p style={heroDescriptionStyle}>{activeWindowMeta.description}</p>
              <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
                <div style={{ padding: '12px 14px', borderRadius: 18, background: 'rgba(15,23,42,0.36)', border: '1px solid rgba(71,85,105,0.26)' }}>
                  <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#94a3b8' }}>活跃工作区</div>
                  <div style={{ marginTop: 6, fontSize: 16, fontWeight: 800, color: '#f8fafc' }}>{activeWindowMeta.eyebrow}</div>
                </div>
                <div style={{ padding: '12px 14px', borderRadius: 18, background: 'rgba(15,23,42,0.36)', border: '1px solid rgba(71,85,105,0.26)' }}>
                  <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#94a3b8' }}>当前策略</div>
                  <div style={{ marginTop: 6, fontSize: 16, fontWeight: 800, color: '#f8fafc' }}>{selectedStrategyPreset?.name || `策略 ${selectedStrategySlotId}`}</div>
                </div>
                <div style={{ padding: '12px 14px', borderRadius: 18, background: 'rgba(15,23,42,0.36)', border: '1px solid rgba(71,85,105,0.26)' }}>
                  <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#94a3b8' }}>市场模式</div>
                  <div style={{ marginTop: 6, fontSize: 16, fontWeight: 800, color: '#f8fafc' }}>{tradeMode === 'live' ? '实盘联动' : '模拟联动'}</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
                <span style={chipStyle({ color: '#e5e7eb', background: 'rgba(255,255,255,0.06)' })}>{strategyType || '-'}</span>
                <span style={chipStyle({ color: '#e5e7eb', background: 'rgba(255,255,255,0.06)' })}>
                  {selectedStrategyPreset?.name || `策略 ${selectedStrategySlotId}`}
                </span>
                <span style={chipStyle({ color: '#cbd5e1', background: 'rgba(148,163,184,0.16)' })}>
                  {(selectedStrategyPreset?.config.symbol || strategy.symbol)} / {(selectedStrategyPreset?.config.timeframe || strategy.timeframe)} / {(selectedStrategyPreset?.config.leverage || strategy.leverage)}x
                </span>
              </div>
            </div>

            <div style={heroRightGridStyle}>
              {heroMiniStats.map((item) => (
                <HeroMiniStat key={item.label} label={item.label} value={item.value} />
              ))}
            </div>
          </section>

          <div style={sectionStackStyle}>
            {activeWindow === 'liveAccount' && (
              <div style={darkPanelStyle}>
                <SectionHeader title="合约实盘账户" hint="连接 Gate.io 真实合约账户，只读查看账户信息与持仓。" />
                <LiveAccountShell
                  inline
                  onStatusChange={(status) => {
                    setLiveAccountStatus(status)
                    if (status.connected) setTradeMode('live')
                  }}
                />
              </div>
            )}

            {activeWindow === 'positions' && (
              <div style={darkPanelStyle}>
                <AccountOverviewSection account={effectiveAccount} />
              </div>
            )}

            <div style={darkPanelStyle}>
              <HistoryOverviewSection historyStats={historyStats} />
            </div>

            {activeWindow === 'positions' && (
              <div style={darkPanelStyle}>
                <SectionHeader title="持仓监控台" hint="账户持仓、浮盈亏与市场参考统一查看。" />
                <PositionsOverviewCard
                  dashboard={dashboard}
                  positionsOverride={effectivePositions}
                  marketTickers={marketTickers}
                  riskConfig={overviewRiskConfig}
                  onClosePosition={handleClosePaper}
                  onCloseAll={handleCloseAll}
                />
              </div>
            )}

            {activeWindow === 'strategy' && (
              <div style={{ display: 'grid', gap: 16 }}>
                <div style={strategyBannerStyle}>
                  <div>
                    <div style={eyebrowStyle}>Strategy Workspace</div>
                    <h3 style={bannerTitleStyle}>策略执行中枢</h3>
                    <p style={bannerTextStyle}>把参数、回测、Runner、风险守卫和策略槽位放进一个控制台节奏里，减少来回切屏。</p>
                  </div>
                  <div style={bannerStatGridStyle}>
                    <HeroMiniStat label="Runner" value={
                      dashboard.runner?.enabled
                        ? (tradeMode === 'live'
                          ? (dashboard.runner?.is_running ? '实盘运行中' : '实盘已启用')
                          : (dashboard.runner?.is_running ? '模拟运行中' : '模拟已启用'))
                        : '未启动'
                    } />
                    <HeroMiniStat label="Preset" value={`${strategyPresets.length}`} />
                    <HeroMiniStat label="Risk" value={`${(strategy.risk_per_trade_pct * 100).toFixed(2)}%`} />
                  </div>
                </div>

                <div style={twoColWideStyle}>
                  <div style={darkPanelStyle}>
                    <SectionHeader title="策略控制台" hint="保留原有保存、回测、Runner 链路，只改工作台体验。" />
                    <RunnerControlCard
                      strategy={strategy}
                      dashboard={dashboard}
                      runnerResult={runnerResult}
                      backtest={backtest}
                      latestRunnerLog={latestRunnerLog}
                      latestClosedPosition={latestClosedPosition}
                      recentOrders={recentOrders}
                      onSave={handleSave}
                      onRunBacktest={handleRunBacktest}
                      onInvalidateBacktest={clearBacktest}
                      onRunStrategyOnce={handleRunStrategyOnce}
                      onToggleRunner={async (enabled, symbols, mode) => handleToggleRunner(enabled, symbols, mode ?? tradeMode)}
                      onResumeRunner={handleResumeRunner}
                      priceReference={strategyPriceReference}
                      strategySlotId={selectedStrategySlotId}
                      onStrategySlotChange={setSelectedStrategySlotId}
                      onStrategySlotNameChange={handleRenameStrategySlot}
                      onAddStrategySlot={handleAddStrategySlot}
                      onDeleteStrategySlot={handleDeleteStrategySlot}
                      strategyPresets={strategyPresets.map((item) => ({ slotId: item.slotId, name: item.name, config: item.config, locked: item.locked ?? false }))}
                    />
                  </div>

                  <div style={rightRailStackStyle}>
                    <div style={darkPanelStyle}>
                      <SectionHeader title="Runner 状态" hint="查看当前轮询状态与策略执行健康度。" />
                      <RunnerStatusCard runner={dashboard.runner} />
                    </div>
                    <div style={darkPanelStyle}>
                      <SectionHeader title="快速概览" hint="把策略、风控和运行状态压缩到右侧信息栏。" />
                      <div style={{ display: 'grid', gap: 12 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                          <div style={{ padding: '14px 16px', borderRadius: 16, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
                            <div style={{ fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.08em' }}>策略类型</div>
                            <div style={{ marginTop: 8, fontSize: 18, fontWeight: 800, color: '#f8fafc' }}>{strategyType === 'ict' ? 'ICT' : strategyType === 'turtle' ? '海龟' : '经典'}</div>
                          </div>
                          <div style={{ padding: '14px 16px', borderRadius: 16, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
                            <div style={{ fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.08em' }}>风险仓位</div>
                            <div style={{ marginTop: 8, fontSize: 18, fontWeight: 800, color: '#f8fafc' }}>{(strategy.risk_per_trade_pct * 100).toFixed(2)}%</div>
                          </div>
                        </div>
                        <div style={{ padding: '14px 16px', borderRadius: 16, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.14)' }}>
                          <div style={{ fontSize: 11, color: '#fbbf24', textTransform: 'uppercase', letterSpacing: '0.08em' }}>当前交易框架</div>
                          <div style={{ marginTop: 8, fontSize: 14, lineHeight: 1.7, color: '#e5e7eb' }}>
                            {(selectedStrategyPreset?.config.symbol || strategy.symbol)} / {(selectedStrategyPreset?.config.timeframe || strategy.timeframe)} / {(selectedStrategyPreset?.config.leverage || strategy.leverage)}x
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div style={darkPanelStyle}>
                  <SectionHeader title="回测摘要" hint="看收益、交易数与核心表现。" />
                  <BacktestSummaryCard backtest={backtest} />
                </div>

                <div style={twoColBalancedStyle}>
                  <div style={darkPanelStyle}>
                    <SectionHeader title="风险回顾" hint="回测风险与关键比率。" />
                    <BacktestRiskCard backtest={backtest} />
                  </div>
                </div>

                <div style={darkPanelStyle}>
                  <SectionHeader title="交易明细" hint="回测成交明细与策略行为。" />
                  <BacktestTradesCard backtest={backtest} />
                </div>
              </div>
            )}

            {activeWindow === 'paper' && (
              <div style={darkPanelStyle}>
                <PaperTradePanel
                  onOpen={handleOpenPaper}
                  onMark={handleMarkPaper}
                  onClose={handleClosePaper}
                  onReset={handleResetPaper}
                  onRunStrategyOnce={handleRunStrategyOnce}
                  accountEquity={dashboard.account.equity}
                  marketTickers={marketTickers}
                  selectedStrategySlotId={selectedStrategySlotId}
                  onSelectedStrategySlotChange={setSelectedStrategySlotId}
                  strategyPresets={strategyPresets.map((item) => ({
                    slotId: item.slotId,
                    name: item.name,
                    config: {
                      symbol: item.config.symbol,
                      leverage: item.config.leverage,
                      strategy_type: item.config.strategy_type,
                      turtle_entry_period: item.config.turtle_entry_period,
                      turtle_exit_period: item.config.turtle_exit_period,
                      turtle_atr_period: item.config.turtle_atr_period,
                      turtle_atr_filter: item.config.turtle_atr_filter,
                      ict_bos_lookback: item.config.ict_bos_lookback,
                      ict_risk_reward: item.config.ict_risk_reward,
                      stop_loss_pct: item.config.stop_loss_pct,
                      take_profit_pct: item.config.take_profit_pct,
                      risk_per_trade_pct: item.config.risk_per_trade_pct,
                      fee_rate: item.config.fee_rate,
                      slippage_rate: item.config.slippage_rate,
                    },
                    locked: item.locked ?? false,
                  }))}
                  onRobotRunningChange={(running) => setRobotState((prev) => ({ ...prev, running }))}
                  onRobotStateChange={(state) => {
                    if (!state.running) {
                      setRobotState({ running: false, baselinePositionIds: [] })
                      return
                    }
                    const baselinePositionIds = effectivePositions.map((item) => item.position_id)
                    setRobotState({ running: true, symbol: state.symbol, baselinePositionIds })
                  }}
                  robotRunning={robotState.running}
                  robotEnabled={Boolean(dashboard.runner?.enabled)}
                  onStartRobot={handleStartRobot}
                  onPauseRobot={handlePauseRobot}
                  positions={effectivePositions.map((item) => ({
                    position_id: item.position_id,
                    symbol: item.symbol as 'BTC_USDT' | 'ETH_USDT',
                    side: item.side,
                    entry_price: item.entry_price,
                    mark_price: item.mark_price,
                    qty: item.qty,
                    leverage: item.leverage,
                    unrealized_pnl: item.unrealized_pnl,
                  }))}
                  tradeMode={tradeMode}
                  onTradeModeChange={setTradeMode}
                  liveConnected={liveConnected}
                  liveEquity={liveAccountStatus?.account?.equity ?? 0}
                  livePositions={(liveAccountStatus?.positions ?? []).map((p) => ({
                    symbol: p.symbol,
                    side: p.side,
                    leverage: p.leverage,
                    size: p.size,
                    entry_price: p.entry_price,
                    mark_price: p.mark_price,
                    unrealized_pnl: p.unrealized_pnl,
                  }))}
                />
              </div>
            )}

            {activeWindow === 'equity' && (
              <div style={darkPanelStyle}>
                <SectionHeader title="权益曲线" hint="观察曲线、回撤与阶段表现。" />
                <EquityCurveCard equityCurve={equityCurve} />
              </div>
            )}

            {activeWindow === 'positionsHistory' && (
              <div style={{ display: 'grid', gap: 16 }}>
                <div style={darkPanelStyle}>
                  <SectionHeader title="持仓历史" hint="这里只保留开仓价、平仓价和盈利，方便快速查看结果。" />
                  <PositionHistoryCard positionHistory={positionHistory} />
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}


export default function HomePage() {
  const [session, setSession] = useState<SessionResponse | null>(null)
  const [sessionLoading, setSessionLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)
  const [formState, setFormState] = useState({ username: '', password: '' })
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    async function restoreSession() {
      try {
        const currentSession = await getSession()
        setSession(currentSession.authenticated ? currentSession : null)
      } catch (error) {
        setAuthError(error instanceof Error ? error.message : '会话检查失败')
        setSession(null)
      } finally {
        setSessionLoading(false)
      }
    }

    void restoreSession()
  }, [])

  async function handleLoginSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setAuthError(null)
    try {
      const nextSession = await login(formState.username.trim(), formState.password)
      setSession(nextSession)
      setFormState((prev) => ({ ...prev, password: '' }))
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : '登录失败')
      setSession(null)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleLogout() {
    try {
      await logout()
    } catch (error) {
      console.warn('logout failed:', error)
    } finally {
      setSession(null)
      setAuthError(null)
      setFormState((prev) => ({ ...prev, password: '' }))
    }
  }

  if (sessionLoading) {
    return <main style={plainStateStyle}>正在检查登录状态...</main>
  }

  if (!session?.authenticated) {
    return (
      <main
        style={{
          minHeight: '100vh',
          display: 'grid',
          gridTemplateColumns: 'minmax(320px, 520px) minmax(280px, 460px)',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 36,
          background: `
            radial-gradient(circle at top left, rgba(34,211,238,0.16) 0%, rgba(2,6,23,0) 28%),
            radial-gradient(circle at bottom right, rgba(59,130,246,0.18) 0%, rgba(2,6,23,0) 26%),
            linear-gradient(180deg, rgba(15,23,42,1) 0%, rgba(2,6,23,1) 100%)
          `,
          padding: 28,
        }}
      >
        <div style={{ display: 'grid', gap: 18, color: '#e2e8f0' }}>
          <div style={{ display: 'inline-flex', width: 'fit-content', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 999, background: 'rgba(14,165,233,0.12)', border: '1px solid rgba(56,189,248,0.18)', color: '#bae6fd', fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Quant Gate Terminal
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 52, lineHeight: 1.02, color: '#f8fafc', letterSpacing: '-0.05em' }}>专业量化控制台</h1>
            <p style={{ margin: '16px 0 0', color: '#94a3b8', lineHeight: 1.8, fontSize: 15, maxWidth: 560 }}>
              登录后进入统一工作台，集中处理策略参数、回测、Runner、实盘账户联动与持仓复盘。
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
            {[
              ['会话鉴权', 'HttpOnly Cookie'],
              ['回测面板', '自定义日期区间'],
              ['交易工作区', '策略 / Runner / 风控联动'],
              ['实盘联动', '账户与持仓同步观察'],
            ].map(([label, value]) => (
              <div key={label} style={{ padding: '16px 16px', borderRadius: 22, background: 'rgba(15,23,42,0.5)', border: '1px solid rgba(71,85,105,0.34)', boxShadow: '0 20px 40px rgba(2,8,23,0.18)' }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#94a3b8' }}>{label}</div>
                <div style={{ marginTop: 8, fontSize: 18, fontWeight: 800, color: '#f8fafc' }}>{value}</div>
              </div>
            ))}
          </div>
        </div>
        <form
          onSubmit={handleLoginSubmit}
          style={{
            width: '100%',
            maxWidth: 460,
            background: 'linear-gradient(180deg, rgba(15,23,42,0.9) 0%, rgba(15,23,42,0.82) 100%)',
            border: '1px solid rgba(71,85,105,0.56)',
            borderRadius: 28,
            padding: 30,
            boxShadow: '0 28px 80px rgba(2,6,23,0.45), inset 0 1px 0 rgba(148,163,184,0.06)',
            display: 'grid',
            gap: 18,
            color: '#e2e8f0',
            backdropFilter: 'blur(18px)',
          }}
        >
          <div>
            <div style={{ fontSize: 12, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#7dd3fc', marginBottom: 8 }}>Secure Access</div>
            <h1 style={{ margin: 0, fontSize: 32, color: '#f8fafc', letterSpacing: '-0.03em' }}>管理员登录</h1>
            <p style={{ margin: '10px 0 0', color: '#94a3b8', lineHeight: 1.6 }}>
              前端现在通过后端会话访问 API，不再在浏览器里暴露公开 API Key。
            </p>
          </div>

          <label style={{ display: 'grid', gap: 8 }}>
            <span style={{ fontSize: 14, color: '#cbd5e1' }}>用户名</span>
            <input
              value={formState.username}
              onChange={(event) => setFormState((prev) => ({ ...prev, username: event.target.value }))}
              placeholder="请输入管理员用户名"
              autoComplete="username"
              style={{
                borderRadius: 16,
                border: '1px solid rgba(71,85,105,0.72)',
                background: 'rgba(2,6,23,0.42)',
                color: '#f8fafc',
                padding: '14px 15px',
                outline: 'none',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.02)',
              }}
            />
          </label>

          <label style={{ display: 'grid', gap: 8 }}>
            <span style={{ fontSize: 14, color: '#cbd5e1' }}>密码</span>
            <input
              type="password"
              value={formState.password}
              onChange={(event) => setFormState((prev) => ({ ...prev, password: event.target.value }))}
              placeholder="请输入管理员密码"
              autoComplete="current-password"
              style={{
                borderRadius: 16,
                border: '1px solid rgba(71,85,105,0.72)',
                background: 'rgba(2,6,23,0.42)',
                color: '#f8fafc',
                padding: '14px 15px',
                outline: 'none',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.02)',
              }}
            />
          </label>

          {authError ? (
            <div
              style={{
                borderRadius: 14,
                border: '1px solid rgba(248,113,113,0.3)',
                background: 'rgba(127,29,29,0.22)',
                color: '#fecaca',
                padding: '12px 14px',
                fontSize: 14,
              }}
            >
              {authError}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={submitting || !formState.username.trim() || !formState.password}
            style={{
              border: 'none',
              borderRadius: 16,
              background: submitting ? 'rgba(14,165,233,0.45)' : 'linear-gradient(135deg, #22d3ee 0%, #2563eb 55%, #4f46e5 100%)',
              color: '#eff6ff',
              padding: '14px 16px',
              fontSize: 15,
              fontWeight: 700,
              cursor: submitting ? 'not-allowed' : 'pointer',
              boxShadow: submitting ? 'none' : '0 18px 42px rgba(37,99,235,0.34)',
            }}
          >
            {submitting ? '登录中...' : '登录进入控制台'}
          </button>
        </form>
      </main>
    )
  }

  return <DashboardPageInner session={session} onLogout={handleLogout} />
}
