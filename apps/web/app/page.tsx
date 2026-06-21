"use client"

import type { FormEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import AccountOverviewSection from '../components/AccountOverviewSection'
import BacktestRiskCard from '../components/BacktestRiskCard'
import BacktestSummaryCard from '../components/BacktestSummaryCard'
import BacktestTradesCard from '../components/BacktestTradesCard'
import EquityCurveCard from '../components/EquityCurveCard'
import HistoryOverviewSection from '../components/HistoryOverviewSection'
import LiveAccountShell from '../components/LiveAccountShell'
import PaperTradePanel from '../components/PaperTradePanel'
import PositionHistoryCard from '../components/PositionHistoryCard'
import PositionsOverviewCard from '../components/PositionsOverviewCard'
import RunnerControlCard from '../components/RunnerControlCard'
import RunnerStatusCard from '../components/RunnerStatusCard'
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

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Activity,
  BarChart3,
  Bot,
  Clock,
  Eye,
  EyeOff,
  History,
  LayoutDashboard,
  LineChart,
  LogOut,
  Shield,
  TrendingUp,
  Wallet,
  Zap,
} from 'lucide-react'

type WindowKey =
  | 'liveAccount'
  | 'positions'
  | 'strategy'
  | 'paper'
  | 'equity'
  | 'positionsHistory'

type TradeMode = 'paper' | 'live'

const WINDOW_OPTIONS: Array<{ key: WindowKey; label: string; description: string; eyebrow: string; icon: React.ElementType }> = [
  { key: 'liveAccount', label: '合约实盘账户', description: 'Gate 合约真实账户连接状态、总览与持仓', eyebrow: 'Live', icon: Zap },
  { key: 'positions', label: '持仓总览', description: '当前账户、仓位与市场参考', eyebrow: 'Overview', icon: LayoutDashboard },
  { key: 'strategy', label: '策略控制台', description: '策略参数、回测、Runner 与风控总控', eyebrow: 'Strategy', icon: Bot },
  { key: 'paper', label: '交易', description: '实盘账户连接与纸面仓位模拟交易', eyebrow: 'Trade', icon: TrendingUp },
  { key: 'equity', label: '权益曲线', description: '账户权益变化与回撤观察', eyebrow: 'Equity', icon: LineChart },
  { key: 'positionsHistory', label: '持仓历史', description: '已结束持仓结果与执行摘要', eyebrow: 'History', icon: History },
]

// --- Shared UI atoms ---

function MetricCard({ label, value, tone }: { label: string; value: string; tone: 'cyan' | 'blue' | 'green' | 'violet' | 'slate' | 'amber' }) {
  const toneColors: Record<string, string> = {
    cyan: 'text-accent-cyan',
    blue: 'text-accent-blue',
    green: 'text-accent-green',
    violet: 'text-accent-violet',
    slate: 'text-text-secondary',
    amber: 'text-accent-amber',
  }
  return (
    <Card className="bg-bg-card border-border p-3">
      <div className="text-[11px] uppercase tracking-[0.08em] text-text-muted">{label}</div>
      <div className={`mt-1 text-lg font-extrabold ${toneColors[tone] ?? 'text-text-primary'}`}>{value}</div>
    </Card>
  )
}

function HeroMiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="inline-block h-2 w-2 rounded-full bg-text-muted" />
      <span className="text-text-muted">{label}</span>
      <span className="font-bold text-text-primary">{value}</span>
    </div>
  )
}

function SectionHeader({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="mb-4">
      <div className="text-[11px] uppercase tracking-[0.08em] text-text-muted">Workspace Panel</div>
      <h3 className="mt-1 text-lg font-extrabold text-text-primary">{title}</h3>
      <p className="mt-1 text-sm text-text-secondary">{hint}</p>
    </div>
  )
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[18px] bg-slate-900/30 border border-slate-700/30 p-3">
      <div className="text-[11px] uppercase tracking-[0.08em] text-text-muted">{label}</div>
      <div className="mt-1.5 text-base font-extrabold text-text-primary">{value}</div>
    </div>
  )
}

// --- Dashboard ---

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

  useEffect(() => {
    if (dashboard?.runner?.is_running !== undefined) {
      setRobotState((prev) => ({
        ...prev,
        running: Boolean(dashboard.runner?.is_running),
      }))
    }
    if (dashboard?.runner?.is_running && dashboard?.runner?.trade_mode) {
      setTradeMode(dashboard.runner.trade_mode)
    }
  }, [dashboard?.runner?.is_running, dashboard?.runner?.trade_mode])

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

  // --- Loading / Error states ---
  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg-primary">
        <Card className="max-w-md border-accent-red/30 bg-bg-card p-8 text-center">
          <div className="text-xl font-bold text-accent-red">加载失败</div>
          <p className="mt-2 text-text-secondary">{error}</p>
        </Card>
      </main>
    )
  }

  if (!dashboard || !strategy || !effectiveAccount) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg-primary">
        <div className="flex items-center gap-3 text-text-secondary">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent-cyan border-t-transparent" />
          正在加载 Quant Gate 控制台...
        </div>
      </main>
    )
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

  const runnerTone = dashboard.runner?.enabled
    ? (tradeMode === 'live' ? 'amber' : (dashboard.runner?.is_running ? 'green' : 'cyan'))
    : 'slate'

  return (
    <main className="min-h-screen bg-bg-primary">
      <div className="grid min-h-screen grid-cols-[280px_1fr]">
        {/* Sidebar */}
        <aside className="flex flex-col border-r border-border bg-bg-secondary/60 p-4">
          {/* Brand */}
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-cyan/10 text-sm font-extrabold text-accent-cyan">
              QG
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-[0.08em] text-text-muted">Trading Console</div>
              <h1 className="text-base font-extrabold text-text-primary">Quant Gate MVP</h1>
            </div>
          </div>
          <p className="mt-2 text-xs text-text-muted">沿用现有量化链路，前端工作台向 3001 风格收口。</p>

          <Separator className="my-4 bg-border" />

          {/* Sidebar metrics */}
          <div className="space-y-2">
            <MetricCard label="账户权益" value={`$${effectiveAccount.equity.toFixed(2)}`} tone="cyan" />
            <MetricCard
              label="最大回撤"
              value={effectiveAccount.max_drawdown_pct != null ? `${(effectiveAccount.max_drawdown_pct * 100).toFixed(2)}%` : '-'}
              tone={(effectiveAccount.max_drawdown_pct ?? 0) > 0.1 ? 'amber' : 'slate'}
            />
            <MetricCard label="Runner" value={runnerModeLabel} tone={runnerTone as any} />
            <MetricCard label="策略" value={selectedStrategyPreset?.name || `策略 ${selectedStrategySlotId}`} tone="blue" />
          </div>

          <Separator className="my-4 bg-border" />

          {/* Navigation */}
          <div className="text-[11px] uppercase tracking-[0.08em] text-text-muted mb-2">工作区</div>
          <ScrollArea className="flex-1">
            <div className="space-y-1">
              {WINDOW_OPTIONS.map((item) => {
                const active = item.key === activeWindow
                const Icon = item.icon
                return (
                  <button
                    key={item.key}
                    onClick={() => setActiveWindow(item.key)}
                    className={`
                      w-full rounded-xl p-3 text-left transition-all
                      ${active
                        ? 'border border-border-active bg-gradient-to-br from-slate-800 to-slate-900 shadow-lg'
                        : 'border border-transparent hover:border-border hover:bg-bg-card'
                      }
                    `}
                  >
                    <div className="flex items-center gap-2">
                      <Icon className={`h-4 w-4 ${active ? 'text-accent-cyan' : 'text-text-muted'}`} />
                      <span className={`text-[11px] uppercase tracking-[0.08em] ${active ? 'text-accent-cyan' : 'text-text-muted'}`}>
                        {item.eyebrow}
                      </span>
                    </div>
                    <div className="mt-1 text-sm font-bold text-text-primary">{item.label}</div>
                    <div className="mt-0.5 text-xs text-text-muted">{item.description}</div>
                  </button>
                )
              })}
            </div>
          </ScrollArea>
        </aside>

        {/* Main content */}
        <section className="flex flex-col overflow-hidden">
          {/* Hero bar */}
          <div className="border-b border-border bg-bg-secondary/40 px-6 py-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 flex-wrap">
                <Badge variant="outline" className="border-accent-cyan/30 text-accent-cyan text-[11px] uppercase tracking-widest">
                  3001 风格控制台
                </Badge>
                <Badge variant="secondary" className="text-xs">管理员：{usernameLabel}</Badge>
                <Badge variant={tradeMode === 'live' ? 'destructive' : 'secondary'} className="text-xs">
                  {tradeMode === 'live' ? 'LIVE' : 'PAPER'} / {runnerModeLabel}
                </Badge>
              </div>
              <Button variant="outline" size="sm" onClick={() => void onLogout()} className="border-border text-text-secondary hover:text-text-primary">
                <LogOut className="mr-2 h-4 w-4" />
                退出登录
              </Button>
            </div>

            <h2 className="mt-3 text-2xl font-extrabold text-text-primary">{activeWindowMeta.label}</h2>
            <p className="mt-1 text-sm text-text-secondary">{activeWindowMeta.description}</p>

            {/* Hero stat tiles */}
            <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2.5">
              <StatTile label="活跃工作区" value={activeWindowMeta.eyebrow} />
              <StatTile label="当前策略" value={selectedStrategyPreset?.name || `策略 ${selectedStrategySlotId}`} />
              <StatTile label="市场模式" value={tradeMode === 'live' ? '实盘联动' : '模拟联动'} />
            </div>

            {/* Strategy chips */}
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge variant="outline" className="text-xs">{strategyType || '-'}</Badge>
              <Badge variant="outline" className="text-xs">{selectedStrategyPreset?.name || `策略 ${selectedStrategySlotId}`}</Badge>
              <Badge variant="secondary" className="text-xs">
                {(selectedStrategyPreset?.config.symbol || strategy.symbol)} / {(selectedStrategyPreset?.config.timeframe || strategy.timeframe)} / {(selectedStrategyPreset?.config.leverage || strategy.leverage)}x
              </Badge>
            </div>

            {/* Hero mini stats */}
            <div className="mt-3 flex flex-wrap gap-4">
              {heroMiniStats.map((item) => (
                <HeroMiniStat key={item.label} label={item.label} value={item.value} />
              ))}
            </div>
          </div>

          {/* Workspace content */}
          <div className="flex-1 overflow-y-auto p-6">
            <div className="space-y-4">
              {/* Live Account */}
              {activeWindow === 'liveAccount' && (
                <Card className="bg-bg-card border-border">
                  <CardContent className="p-6">
                    <SectionHeader title="合约实盘账户" hint="连接 Gate.io 真实合约账户，只读查看账户信息与持仓。" />
                    <LiveAccountShell
                      inline
                      onStatusChange={(status) => {
                        setLiveAccountStatus(status)
                        if (status.connected) setTradeMode('live')
                      }}
                    />
                  </CardContent>
                </Card>
              )}

              {/* Positions overview */}
              {activeWindow === 'positions' && (
                <Card className="bg-bg-card border-border">
                  <CardContent className="p-6">
                    <AccountOverviewSection account={effectiveAccount} />
                  </CardContent>
                </Card>
              )}

              {/* History stats - always visible */}
              <Card className="bg-bg-card border-border">
                <CardContent className="p-6">
                  <HistoryOverviewSection historyStats={historyStats} />
                </CardContent>
              </Card>

              {/* Positions table */}
              {activeWindow === 'positions' && (
                <Card className="bg-bg-card border-border">
                  <CardContent className="p-6">
                    <SectionHeader title="持仓监控台" hint="账户持仓、浮盈亏与市场参考统一查看。" />
                    <PositionsOverviewCard
                      dashboard={dashboard}
                      positionsOverride={effectivePositions}
                      marketTickers={marketTickers}
                      riskConfig={overviewRiskConfig}
                      onClosePosition={handleClosePaper}
                      onCloseAll={handleCloseAll}
                    />
                  </CardContent>
                </Card>
              )}

              {/* Strategy workspace */}
              {activeWindow === 'strategy' && (
                <div className="space-y-4">
                  {/* Strategy banner */}
                  <Card className="bg-gradient-to-r from-slate-900 to-slate-800 border-border">
                    <CardContent className="p-6">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.08em] text-text-muted">Strategy Workspace</div>
                          <h3 className="mt-1 text-xl font-extrabold text-text-primary">策略执行中枢</h3>
                          <p className="mt-1 text-sm text-text-secondary">把参数、回测、Runner、风险守卫和策略槽位放进一个控制台节奏里，减少来回切屏。</p>
                        </div>
                        <div className="flex gap-4">
                          <HeroMiniStat label="Runner" value={runnerModeLabel} />
                          <HeroMiniStat label="Preset" value={`${strategyPresets.length}`} />
                          <HeroMiniStat label="Risk" value={`${(strategy.risk_per_trade_pct * 100).toFixed(2)}%`} />
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Strategy main grid */}
                  <div className="grid grid-cols-[1fr_320px] gap-4">
                    {/* Left: Runner control */}
                    <Card className="bg-bg-card border-border">
                      <CardContent className="p-6">
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
                      </CardContent>
                    </Card>

                    {/* Right rail */}
                    <div className="space-y-4">
                      <Card className="bg-bg-card border-border">
                        <CardContent className="p-6">
                          <SectionHeader title="Runner 状态" hint="查看当前轮询状态与策略执行健康度。" />
                          <RunnerStatusCard runner={dashboard.runner} />
                        </CardContent>
                      </Card>

                      <Card className="bg-bg-card border-border">
                        <CardContent className="p-6">
                          <SectionHeader title="快速概览" hint="把策略、风控和运行状态压缩到右侧信息栏。" />
                          <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-2.5">
                              <div className="rounded-2xl bg-white/[0.04] border border-white/[0.06] p-3.5">
                                <div className="text-[11px] text-text-muted uppercase tracking-[0.08em]">策略类型</div>
                                <div className="mt-2 text-lg font-extrabold text-text-primary">
                                  {strategyType === 'ict' ? 'ICT' : strategyType === 'ifvg' ? 'IFVG' : strategyType === 'turtle' ? '海龟' : strategyType === 'macd_trend' ? 'MACD趋势' : '经典'}
                                </div>
                              </div>
                              <div className="rounded-2xl bg-white/[0.04] border border-white/[0.06] p-3.5">
                                <div className="text-[11px] text-text-muted uppercase tracking-[0.08em]">风险仓位</div>
                                <div className="mt-2 text-lg font-extrabold text-text-primary">{(strategy.risk_per_trade_pct * 100).toFixed(2)}%</div>
                              </div>
                            </div>
                            <div className="rounded-2xl bg-accent-amber/[0.08] border border-accent-amber/[0.14] p-3.5">
                              <div className="text-[11px] text-accent-amber uppercase tracking-[0.08em]">当前交易框架</div>
                              <div className="mt-2 text-sm leading-relaxed text-text-secondary">
                                {(selectedStrategyPreset?.config.symbol || strategy.symbol)} / {(selectedStrategyPreset?.config.timeframe || strategy.timeframe)} / {(selectedStrategyPreset?.config.leverage || strategy.leverage)}x
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  </div>

                  {/* Backtest results */}
                  <Card className="bg-bg-card border-border">
                    <CardContent className="p-6">
                      <SectionHeader title="回测摘要" hint="看收益、交易数与核心表现。" />
                      <BacktestSummaryCard backtest={backtest} />
                    </CardContent>
                  </Card>

                  <Card className="bg-bg-card border-border">
                    <CardContent className="p-6">
                      <SectionHeader title="风险回顾" hint="回测风险与关键比率。" />
                      <BacktestRiskCard backtest={backtest} />
                    </CardContent>
                  </Card>

                  <Card className="bg-bg-card border-border">
                    <CardContent className="p-6">
                      <SectionHeader title="交易明细" hint="回测成交明细与策略行为。" />
                      <BacktestTradesCard backtest={backtest} />
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* Paper / Live trade */}
              {activeWindow === 'paper' && (
                <Card className="bg-bg-card border-border">
                  <CardContent className="p-6">
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
                  </CardContent>
                </Card>
              )}

              {/* Equity curve */}
              {activeWindow === 'equity' && (
                <Card className="bg-bg-card border-border">
                  <CardContent className="p-6">
                    <SectionHeader title="权益曲线" hint="观察曲线、回撤与阶段表现。" />
                    <EquityCurveCard equityCurve={equityCurve} />
                  </CardContent>
                </Card>
              )}

              {/* Position history */}
              {activeWindow === 'positionsHistory' && (
                <Card className="bg-bg-card border-border">
                  <CardContent className="p-6">
                    <SectionHeader title="持仓历史" hint="这里只保留开仓价、平仓价和盈利，方便快速查看结果。" />
                    <PositionHistoryCard positionHistory={positionHistory} />
                  </CardContent>
                </Card>
              )}
            </div>
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
  const [showPassword, setShowPassword] = useState(false)
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
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg-primary">
        <div className="flex items-center gap-3 text-text-secondary">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent-cyan border-t-transparent" />
          正在检查登录状态...
        </div>
      </main>
    )
  }

  if (!session?.authenticated) {
    return (
      <main className="min-h-screen grid grid-cols-[minmax(320px,520px)_minmax(280px,460px)] justify-center items-center gap-9 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.16)_0%,transparent_28%),radial-gradient(circle_at_bottom_right,rgba(59,130,246,0.18)_0%,transparent_26%),linear-gradient(180deg,rgb(15,23,42)_0%,rgb(2,6,23)_100%)] p-7">
        {/* Left: Features */}
        <div className="space-y-5 text-slate-300">
          <Badge variant="outline" className="w-fit border-accent-cyan/30 bg-accent-cyan/[0.12] text-accent-cyan text-[12px] font-extrabold uppercase tracking-[0.08em]">
            Quant Gate Terminal
          </Badge>
          <div>
            <h1 className="text-[52px] leading-[1.02] font-extrabold text-text-primary tracking-[-0.05em]">专业量化控制台</h1>
            <p className="mt-4 text-text-secondary leading-relaxed text-[15px] max-w-[560px]">
              登录后进入统一工作台，集中处理策略参数、回测、Runner、实盘账户联动与持仓复盘。
            </p>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
            {[
              ['会话鉴权', 'HttpOnly Cookie'],
              ['回测面板', '自定义日期区间'],
              ['交易工作区', '策略 / Runner / 风控联动'],
              ['实盘联动', '账户与持仓同步观察'],
            ].map(([label, value]) => (
              <Card key={label} className="bg-slate-900/50 border-slate-700/40 p-4 shadow-xl">
                <div className="text-[11px] uppercase tracking-[0.08em] text-text-muted">{label}</div>
                <div className="mt-2 text-lg font-extrabold text-text-primary">{value}</div>
              </Card>
            ))}
          </div>
        </div>

        {/* Right: Login form */}
        <Card className="w-full max-w-[460px] bg-gradient-to-b from-slate-900/90 to-slate-900/80 border-slate-700/60 shadow-2xl backdrop-blur-xl">
          <CardContent className="p-8 space-y-5">
            <div>
              <div className="text-[12px] tracking-[0.16em] uppercase text-sky-400 mb-2">Secure Access</div>
              <h1 className="text-3xl font-extrabold text-text-primary tracking-[-0.03em]">管理员登录</h1>
              <p className="mt-2.5 text-text-secondary leading-relaxed">
                前端现在通过后端会话访问 API，不再在浏览器里暴露公开 API Key。
              </p>
            </div>

            <form onSubmit={handleLoginSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label className="text-sm text-slate-300">用户名</Label>
                <Input
                  value={formState.username}
                  onChange={(event) => setFormState((prev) => ({ ...prev, username: event.target.value }))}
                  placeholder="请输入管理员用户名"
                  autoComplete="username"
                  className="rounded-2xl border-slate-600/80 bg-slate-950/50 text-text-primary placeholder:text-text-muted h-12"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-sm text-slate-300">密码</Label>
                <div className="relative">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    value={formState.password}
                    onChange={(event) => setFormState((prev) => ({ ...prev, password: event.target.value }))}
                    placeholder="请输入管理员密码"
                    autoComplete="current-password"
                    className="h-12 rounded-2xl border-slate-600/80 bg-slate-950/50 pr-12 text-text-primary placeholder:text-text-muted"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={showPassword ? '隐藏密码' : '显示密码'}
                    title={showPassword ? '隐藏密码' : '显示密码'}
                    onClick={() => setShowPassword((visible) => !visible)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:bg-slate-800/70 hover:text-slate-100"
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </Button>
                </div>
              </div>

              {authError && (
                <div className="rounded-[14px] border border-red-400/30 bg-red-950/30 px-3.5 py-3 text-sm text-red-200">
                  {authError}
                </div>
              )}

              <Button
                type="submit"
                disabled={submitting || !formState.username.trim() || !formState.password}
                className="w-full h-12 rounded-2xl bg-gradient-to-r from-accent-cyan via-accent-blue to-indigo-600 text-white font-bold text-[15px] shadow-lg shadow-accent-blue/30 hover:opacity-90 disabled:opacity-50"
              >
                {submitting ? '登录中...' : '登录进入控制台'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
    )
  }

  return <DashboardPageInner session={session} onLogout={handleLogout} />
}
