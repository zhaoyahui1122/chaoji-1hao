"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import AccountOverviewSection from '../components/AccountOverviewSection'
import BacktestRiskCard from '../components/BacktestRiskCard'
import BacktestSummaryCard from '../components/BacktestSummaryCard'
import BacktestTradesCard from '../components/BacktestTradesCard'
import EquityCurveCard from '../components/EquityCurveCard'
import HistoryFilterCard from '../components/HistoryFilterCard'
import HistoryOverviewSection from '../components/HistoryOverviewSection'
import HistoryStatsCard from '../components/HistoryStatsCard'
import LiveAccountShell from '../components/LiveAccountShell'
import OrderHistoryCard from '../components/OrderHistoryCard'
import PaperTradePanel from '../components/PaperTradePanel'
import PositionHistoryCard from '../components/PositionHistoryCard'
import PositionsOverviewCard from '../components/PositionsOverviewCard'
import RunnerControlCard from '../components/RunnerControlCard'
import RunnerGuardCard from '../components/RunnerGuardCard'
import RunnerLogsCard from '../components/RunnerLogsCard'
import RunnerStatusCard from '../components/RunnerStatusCard'
import SupportScopeCard from '../components/SupportScopeCard'
import { chipStyle } from '../components/dashboard-types'
import { buildLiveAccountOverview } from '../components/dashboard-utils'
import { useDashboardPageData } from '../components/useDashboardPageData'
import { getLiveAccountStatus, type LiveAccountStatus } from '../lib/api'

type WindowKey =
  | 'liveAccount'
  | 'positions'
  | 'strategy'
  | 'paper'
  | 'filters'
  | 'historyStats'
  | 'equity'
  | 'orders'
  | 'positionsHistory'

type TradeMode = 'paper' | 'live'

const WINDOW_OPTIONS: Array<{ key: WindowKey; label: string; description: string; eyebrow: string }> = [
  { key: 'liveAccount', label: '合约实盘账户', description: 'Gate 合约真实账户连接状态、总览与持仓', eyebrow: 'Live' },
  { key: 'positions', label: '持仓总览', description: '当前账户、仓位、风险暴露与市场参考', eyebrow: 'Overview' },
  { key: 'strategy', label: '策略控制台', description: '策略参数、回测、Runner 与风控总控', eyebrow: 'Strategy' },
  { key: 'paper', label: '交易', description: '实盘账户连接与纸面仓位模拟交易', eyebrow: 'Trade' },
  { key: 'filters', label: '历史筛选', description: '订单与持仓历史筛选条件', eyebrow: 'Filters' },
  { key: 'historyStats', label: '历史统计', description: '收益、成本、胜率等关键统计', eyebrow: 'Stats' },
  { key: 'equity', label: '权益曲线', description: '账户权益变化与回撤观察', eyebrow: 'Equity' },
  { key: 'orders', label: '订单与日志', description: '历史订单与 Runner 日志窗口', eyebrow: 'Orders' },
  { key: 'positionsHistory', label: '持仓历史', description: '已结束持仓结果与执行摘要', eyebrow: 'History' },
]

export default function HomePage() {
  const {
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
    handleRunStrategyOnce,
    handleToggleRunner,
    handleResumeRunner,
    handleOpenPaper,
    handleMarkPaper,
    handleClosePaper,
    handleResetPaper,
  } = useDashboardPageData()

  const [activeWindow, setActiveWindow] = useState<WindowKey>('strategy')
  const [tradeMode, setTradeMode] = useState<TradeMode>('paper')
  const [liveAccountStatus, setLiveAccountStatus] = useState<LiveAccountStatus | null>(null)
  const livePollRef = useRef<ReturnType<typeof setInterval> | null>(null)
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

  // 从后端同步机器人运行状态（刷新页面后恢复）
  useEffect(() => {
    if (dashboard?.runner?.enabled !== undefined) {
      setRobotState((prev) => ({
        ...prev,
        running: dashboard.runner!.enabled,
      }))
    }
  }, [dashboard?.runner?.enabled])

  async function handleStartRobot(symbols?: Array<'BTC_USDT' | 'ETH_USDT'>) {
    const selectedSymbols: Array<'BTC_USDT' | 'ETH_USDT'> = symbols && symbols.length > 0
      ? symbols
      : dashboard?.runner?.selected_symbols && dashboard.runner.selected_symbols.length > 0
        ? dashboard.runner.selected_symbols
        : ['BTC_USDT', 'ETH_USDT']
    await handleToggleRunner(true, selectedSymbols)
  }

  async function handlePauseRobot() {
    await handleToggleRunner(false)
    setRobotState({ running: false, baselinePositionIds: [] })
  }

  const positionsForOverview = useMemo(() => {
    const all = dashboard?.positions ?? []
    const bySymbol = robotState.symbol ? all.filter((item) => item.symbol === robotState.symbol) : all
    const baseline = new Set(robotState.baselinePositionIds)
    return robotState.running ? bySymbol.filter((item) => !baseline.has(item.position_id)) : []
  }, [dashboard?.positions, robotState])

  const liveAccountOverview = useMemo(
    () => dashboard ? buildLiveAccountOverview(dashboard.account, dashboard.positions, marketTickers) : null,
    [dashboard, marketTickers],
  )

  if (error) {
    return <main style={plainStateStyle}>加载失败：{error}</main>
  }

  if (!dashboard || !strategy || !liveAccountOverview) {
    return <main style={plainStateStyle}>正在加载 Quant Gate 控制台...</main>
  }

  const activeWindowMeta = WINDOW_OPTIONS.find((item) => item.key === activeWindow) || WINDOW_OPTIONS[0]
  const selectedStrategyPreset = strategyPresets.find((item) => item.slotId === selectedStrategySlotId) || null
  const strategyType = selectedStrategyPreset?.config.strategy_type || strategy.strategy_type
  const latestRunnerAction = latestRunnerLog?.result?.action || latestRunnerLog?.result?.reason || '-'
  const overviewRiskConfig = {
    stopLossPct: selectedStrategyPreset?.config.stop_loss_pct ?? strategy.stop_loss_pct,
    takeProfitPct: selectedStrategyPreset?.config.take_profit_pct ?? strategy.take_profit_pct,
  }
  const showLiveData = tradeMode === 'live' && liveConnected && liveAccountStatus?.account
  const heroMiniStats = showLiveData
    ? [
        { label: '账户权益', value: `$${liveAccountStatus.account.equity.toFixed(2)}` },
        { label: '可用余额', value: `$${liveAccountStatus.account.available_balance.toFixed(2)}` },
        { label: '未实现盈亏', value: `$${liveAccountStatus.account.unrealized_pnl.toFixed(2)}` },
        { label: '当前持仓数', value: `${liveAccountStatus.positions.length}` },
      ]
    : [
        { label: '账户权益', value: `$${liveAccountOverview.equity.toFixed(2)}` },
        { label: '可用余额', value: `$${liveAccountOverview.available_balance.toFixed(2)}` },
        { label: '未实现盈亏', value: `$${liveAccountOverview.unrealized_pnl.toFixed(2)}` },
        { label: '当前持仓数', value: `${dashboard.positions.length}` },
      ]

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
            <MetricCard label="账户权益" value={`$${liveAccountOverview.equity.toFixed(2)}`} tone="cyan" />
            <MetricCard label="风险暴露" value={`${(liveAccountOverview.exposure_ratio * 100).toFixed(2)}%`} tone="blue" />
            <MetricCard label="Runner" value={dashboard.runner?.enabled ? (dashboard.runner?.is_running ? '运行中' : '已启用') : '未启动'} tone={dashboard.runner?.enabled ? (dashboard.runner?.is_running ? 'green' : 'cyan') : 'slate'} />
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
                      border: active ? '1px solid rgba(56, 189, 248, 0.35)' : isLive ? '1px solid rgba(56, 189, 248, 0.24)' : '1px solid rgba(51, 65, 85, 0.95)',
                      background: active ? 'linear-gradient(135deg, rgba(30,41,59,0.98) 0%, rgba(15,23,42,1) 100%)' : isLive ? 'linear-gradient(135deg, rgba(8,47,73,0.72) 0%, rgba(15,23,42,0.96) 100%)' : 'rgba(15,23,42,0.78)',
                      boxShadow: active ? 'inset 0 0 0 1px rgba(125,211,252,0.15), 0 18px 34px rgba(2,8,23,0.35)' : isLive ? 'inset 0 0 0 1px rgba(125,211,252,0.1), 0 18px 34px rgba(2,8,23,0.26)' : 'none',
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
              <div style={heroPillStyle}>3001 风格控制台 / 深色工作台</div>
              <h2 style={heroTitleStyle}>{activeWindowMeta.label}</h2>
              <p style={heroDescriptionStyle}>{activeWindowMeta.description}</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
                <span style={chipStyle({ color: '#bae6fd', background: 'rgba(14,165,233,0.14)' })}>{strategyType || '-'}</span>
                <span style={chipStyle({ color: '#d1fae5', background: 'rgba(16,185,129,0.14)' })}>
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
                <LiveAccountShell inline />
              </div>
            )}

            {activeWindow === 'positions' && (
              <div style={darkPanelStyle}>
                <AccountOverviewSection account={liveAccountOverview} />
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
                  positionsOverride={positionsForOverview}
                  marketTickers={marketTickers}
                  riskConfig={overviewRiskConfig}
                  onClosePosition={handleClosePaper}
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
                    <HeroMiniStat label="Runner" value={dashboard.runner?.is_running ? '运行中' : '暂停'} />
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
                      onRunStrategyOnce={handleRunStrategyOnce}
                      onToggleRunner={handleToggleRunner}
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

                  <div style={{ display: 'grid', gap: 16 }}>
                    <div style={darkPanelStyle}>
                      <SectionHeader title="Runner 状态" hint="查看当前轮询状态与策略执行健康度。" />
                      <RunnerStatusCard runner={dashboard.runner} />
                    </div>
                    <div style={darkPanelStyle}>
                      <SectionHeader title="风控守卫" hint="观察策略运行边界与保护开关。" />
                      <RunnerGuardCard runner={dashboard.runner} />
                    </div>
                  </div>
                </div>

                <div style={twoColBalancedStyle}>
                  <div style={darkPanelStyle}>
                    <SectionHeader title="支持范围" hint="当前交易对、数据源和支持说明。" />
                    <SupportScopeCard dashboard={dashboard} />
                  </div>
                  <div style={darkPanelStyle}>
                    <SectionHeader title="回测摘要" hint="看收益、交易数与核心表现。" />
                    <BacktestSummaryCard backtest={backtest} />
                  </div>
                </div>

                <div style={twoColBalancedStyle}>
                  <div style={darkPanelStyle}>
                    <SectionHeader title="风险回顾" hint="回测风险与关键比率。" />
                    <BacktestRiskCard backtest={backtest} />
                  </div>
                  <div style={darkPanelStyle}>
                    <SectionHeader title="交易明细" hint="回测成交明细与策略行为。" />
                    <BacktestTradesCard backtest={backtest} />
                  </div>
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
                    const baselinePositionIds = (dashboard?.positions ?? []).map((item) => item.position_id)
                    setRobotState({ running: true, symbol: state.symbol, baselinePositionIds })
                  }}
                  robotRunning={robotState.running}
                  onStartRobot={handleStartRobot}
                  onPauseRobot={handlePauseRobot}
                  positions={dashboard.positions.map((item) => ({
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

            {activeWindow === 'filters' && (
              <div style={darkPanelStyle}>
                <SectionHeader title="历史筛选器" hint="限定时间、状态与查看范围。" />
                <HistoryFilterCard historyFilters={historyFilters} setHistoryFilters={setHistoryFilters} />
              </div>
            )}

            {activeWindow === 'historyStats' && (
              <div style={darkPanelStyle}>
                <SectionHeader title="历史统计面板" hint="收益、成本、命中率等统计汇总。" />
                <HistoryStatsCard historyStats={historyStats} />
              </div>
            )}

            {activeWindow === 'equity' && (
              <div style={darkPanelStyle}>
                <SectionHeader title="权益曲线" hint="观察曲线、回撤与阶段表现。" />
                <EquityCurveCard equityCurve={equityCurve} />
              </div>
            )}

            {activeWindow === 'orders' && (
              <div style={{ display: 'grid', gap: 16 }}>
                <div style={strategyBannerStyle}>
                  <div>
                    <div style={eyebrowStyle}>Execution Replay</div>
                    <h3 style={bannerTitleStyle}>订单与 Runner 工作台</h3>
                    <p style={bannerTextStyle}>把最新成交、执行决策与完整时间线放进同一视图，减少订单复盘时的来回切换。</p>
                  </div>
                  <div style={bannerStatGridStyle}>
                    <HeroMiniStat label="Orders" value={`${orderHistory.length}`} />
                    <HeroMiniStat label="Logs" value={`${runnerLogs.length}`} />
                    <HeroMiniStat label="Latest Event" value={orderHistory[0]?.event_type || '-'} />
                    <HeroMiniStat label="Latest Action" value={latestRunnerAction} />
                  </div>
                </div>

                <div style={twoColWideStyle}>
                  <div style={{ display: 'grid', gap: 16 }}>
                    <div style={darkPanelStyle}>
                      <SectionHeader title="订单回放" hint="以订单事件链为主视角查看开仓、盯市和平仓。" />
                      <OrderHistoryCard orderHistory={orderHistory} historyFilters={historyFilters} />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gap: 16 }}>
                    <div style={darkPanelStyle}>
                      <SectionHeader title="策略执行日志" hint="从 Runner 决策、信号与事件写入结果追踪执行脉络。" />
                      <RunnerLogsCard runnerLogs={runnerLogs} />
                    </div>
                  </div>
                </div>
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

function MetricCard({ label, value, tone }: { label: string; value: string; tone: 'cyan' | 'blue' | 'green' | 'violet' | 'slate' }) {
  const toneMap: Record<typeof tone, { border: string; glow: string; value: string }> = {
    cyan: { border: 'rgba(34,211,238,0.28)', glow: 'rgba(8,145,178,0.18)', value: '#a5f3fc' },
    blue: { border: 'rgba(59,130,246,0.24)', glow: 'rgba(37,99,235,0.16)', value: '#bfdbfe' },
    green: { border: 'rgba(16,185,129,0.24)', glow: 'rgba(5,150,105,0.16)', value: '#a7f3d0' },
    violet: { border: 'rgba(168,85,247,0.24)', glow: 'rgba(126,34,206,0.16)', value: '#e9d5ff' },
    slate: { border: 'rgba(148,163,184,0.2)', glow: 'rgba(51,65,85,0.18)', value: '#e2e8f0' },
  }
  const palette = toneMap[tone]
  return (
    <div style={{ ...sidebarMetricCardStyle, border: `1px solid ${palette.border}`, boxShadow: `inset 0 0 0 1px rgba(255,255,255,0.02), 0 14px 28px ${palette.glow}` }}>
      <div style={sidebarMetricLabelStyle}>{label}</div>
      <div style={{ ...sidebarMetricValueStyle, color: palette.value }}>{value}</div>
    </div>
  )
}

function HeroMiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={heroMiniStatStyle}>
      <div style={heroMiniLabelStyle}>{label}</div>
      <div style={heroMiniValueStyle}>{value}</div>
    </div>
  )
}

function SectionHeader({ title, hint }: { title: string; hint: string }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={eyebrowStyle}>Workspace Panel</div>
      <h3 style={sectionTitleStyle}>{title}</h3>
      <p style={sectionHintStyle}>{hint}</p>
    </div>
  )
}

const plainStateStyle: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
  background: '#020617',
  color: '#e2e8f0',
  fontFamily: 'Inter, Arial, sans-serif',
}

const shellStyle: React.CSSProperties = {
  minHeight: '100vh',
  background: 'radial-gradient(circle at top left, rgba(14,165,233,0.16) 0%, rgba(2,6,23,0.95) 28%, #020617 62%, #020617 100%)',
  color: '#e2e8f0',
  fontFamily: 'Inter, Arial, sans-serif',
}

const shellGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '300px minmax(0, 1fr)',
  gridTemplateRows: '1fr',
  gap: 20,
  padding: 20,
  height: '100vh',
  overflow: 'hidden',
}

const sidebarStyle: React.CSSProperties = {
  position: 'sticky',
  top: 20,
  display: 'grid',
  gap: 18,
  padding: 18,
  borderRadius: 28,
  background: 'linear-gradient(180deg, rgba(15,23,42,0.94) 0%, rgba(2,6,23,0.98) 100%)',
  border: '1px solid rgba(51,65,85,0.9)',
  boxShadow: '0 28px 60px rgba(2,8,23,0.45)',
  maxHeight: 'calc(100vh - 40px)',
  overflowY: 'auto',
}

const brandWrapStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '56px 1fr',
  gap: 14,
  alignItems: 'start',
}

const brandBadgeStyle: React.CSSProperties = {
  width: 56,
  height: 56,
  borderRadius: 18,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontWeight: 900,
  letterSpacing: '0.08em',
  color: '#dbeafe',
  background: 'linear-gradient(135deg, #0ea5e9 0%, #1d4ed8 100%)',
  boxShadow: '0 18px 36px rgba(37,99,235,0.35)',
}

const brandTitleStyle: React.CSSProperties = {
  margin: '4px 0 0',
  fontSize: 24,
  color: '#f8fafc',
}

const brandSubtleStyle: React.CSSProperties = {
  margin: '8px 0 0',
  fontSize: 13,
  lineHeight: 1.65,
  color: '#94a3b8',
}

const eyebrowStyle: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: '#38bdf8',
}

const sidebarStatStackStyle: React.CSSProperties = {
  display: 'grid',
  gap: 10,
}

const sidebarMetricCardStyle: React.CSSProperties = {
  display: 'grid',
  gap: 6,
  padding: '14px 16px',
  borderRadius: 18,
  background: 'rgba(15,23,42,0.88)',
}

const sidebarMetricLabelStyle: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#94a3b8',
}

const sidebarMetricValueStyle: React.CSSProperties = {
  fontSize: 19,
  fontWeight: 800,
}

const navSectionStyle: React.CSSProperties = {
  display: 'grid',
  gap: 10,
}

const navSectionTitleStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 800,
  color: '#cbd5e1',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
}

const navListStyle: React.CSSProperties = {
  display: 'grid',
  gap: 10,
}

const navButtonStyle: React.CSSProperties = {
  display: 'grid',
  gap: 6,
  padding: '14px 14px 13px',
  borderRadius: 18,
  textAlign: 'left',
  cursor: 'pointer',
  transition: 'all 0.2s ease',
  color: '#e2e8f0',
}

const navEyebrowStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#38bdf8',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
}

const navLabelStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 800,
  color: '#f8fafc',
}

const navDescStyle: React.CSSProperties = {
  fontSize: 12,
  lineHeight: 1.6,
  color: '#94a3b8',
}

const contentStyle: React.CSSProperties = {
  display: 'grid',
  gap: 18,
  overflowY: 'auto',
  maxHeight: '100vh',
  paddingBottom: 20,
}

const heroStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1.2fr) minmax(320px, 0.9fr)',
  gap: 18,
  padding: 24,
  borderRadius: 30,
  background: 'linear-gradient(135deg, rgba(15,23,42,0.92) 0%, rgba(15,23,42,0.95) 35%, rgba(30,41,59,0.95) 100%)',
  border: '1px solid rgba(51,65,85,0.8)',
  boxShadow: '0 28px 80px rgba(2,8,23,0.42)',
}

const heroPillStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 10px',
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 800,
  color: '#bae6fd',
  background: 'rgba(14,165,233,0.14)',
  border: '1px solid rgba(14,165,233,0.18)',
}

const heroTitleStyle: React.CSSProperties = {
  margin: '14px 0 0',
  fontSize: 34,
  lineHeight: 1.05,
  color: '#f8fafc',
  letterSpacing: '-0.03em',
}

const heroDescriptionStyle: React.CSSProperties = {
  margin: '12px 0 0',
  fontSize: 15,
  lineHeight: 1.7,
  color: '#94a3b8',
  maxWidth: 760,
}

const heroRightGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 12,
  alignSelf: 'stretch',
}

const heroMiniStatStyle: React.CSSProperties = {
  display: 'grid',
  gap: 6,
  padding: '14px 16px',
  borderRadius: 20,
  background: 'linear-gradient(180deg, rgba(15,23,42,0.95) 0%, rgba(30,41,59,0.92) 100%)',
  border: '1px solid rgba(71,85,105,0.55)',
}

const heroMiniLabelStyle: React.CSSProperties = {
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: '#94a3b8',
}

const heroMiniValueStyle: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 800,
  color: '#f8fafc',
}

const sectionStackStyle: React.CSSProperties = {
  display: 'grid',
  gap: 16,
}

const darkPanelStyle: React.CSSProperties = {
  padding: 18,
  borderRadius: 24,
  background: 'linear-gradient(180deg, rgba(15,23,42,0.88) 0%, rgba(2,6,23,0.92) 100%)',
  border: '1px solid rgba(51,65,85,0.72)',
  boxShadow: '0 18px 44px rgba(2,8,23,0.28)',
}

const sectionTitleStyle: React.CSSProperties = {
  margin: '6px 0 0',
  fontSize: 22,
  color: '#f8fafc',
}

const sectionHintStyle: React.CSSProperties = {
  margin: '8px 0 0',
  fontSize: 13,
  lineHeight: 1.6,
  color: '#94a3b8',
}

const strategyBannerStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1.15fr) minmax(320px, 0.85fr)',
  gap: 18,
  padding: 20,
  borderRadius: 26,
  background: 'linear-gradient(135deg, rgba(30,41,59,0.98) 0%, rgba(30,64,175,0.85) 48%, rgba(15,118,110,0.82) 100%)',
  border: '1px solid rgba(125,211,252,0.16)',
}

const bannerTitleStyle: React.CSSProperties = {
  margin: '6px 0 0',
  fontSize: 28,
  color: '#f8fafc',
  letterSpacing: '-0.03em',
}

const bannerTextStyle: React.CSSProperties = {
  margin: '10px 0 0',
  fontSize: 14,
  lineHeight: 1.7,
  color: 'rgba(226,232,240,0.85)',
}

const bannerStatGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 12,
}

const twoColWideStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1.3fr) minmax(320px, 0.9fr)',
  gap: 16,
  alignItems: 'start',
}

const twoColBalancedStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 16,
  alignItems: 'start',
}
