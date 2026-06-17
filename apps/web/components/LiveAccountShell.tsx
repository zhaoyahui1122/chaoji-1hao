"use client"

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  closeLivePosition,
  connectLiveAccount,
  getLiveAccountStatus,
  refreshLiveAccount,
  type LiveAccountStatus,
} from '../lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'

const POLL_INTERVAL_MS = 10_000

export default function LiveAccountShell({
  inline = false,
  onStatusChange,
}: {
  inline?: boolean
  onStatusChange?: (status: LiveAccountStatus) => void
}) {
  const [status, setStatus] = useState<LiveAccountStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [closingSymbol, setClosingSymbol] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [apiKey, setApiKey] = useState('')
  const [apiSecret, setApiSecret] = useState('')

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const load = useCallback(async () => {
    try {
      const data = await getLiveAccountStatus()
      setStatus(data)
      onStatusChange?.(data)
      setError(null)
    } catch {
      setError('无法加载实盘账户状态')
    } finally {
      setLoading(false)
    }
  }, [onStatusChange])

  useEffect(() => {
    load()
    return clearTimer
  }, [load, clearTimer])

  useEffect(() => {
    clearTimer()
    if (status?.connected) {
      timerRef.current = setInterval(async () => {
        try {
          const data = await getLiveAccountStatus()
          setStatus(data)
          onStatusChange?.(data)
        } catch { /* ignore poll errors */ }
      }, POLL_INTERVAL_MS)
    }
    return clearTimer
  }, [status?.connected, clearTimer, onStatusChange])

  const handleConnect = async () => {
    if (!apiKey.trim() || !apiSecret.trim()) return
    setConnecting(true)
    setError(null)
    try {
      const data = await connectLiveAccount(apiKey.trim(), apiSecret.trim())
      setStatus(data)
      onStatusChange?.(data)
      setApiKey('')
      setApiSecret('')
    } catch (err: any) {
      setError(err.message || '连接失败')
    } finally {
      setConnecting(false)
    }
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      const data = await refreshLiveAccount()
      setStatus(data)
      onStatusChange?.(data)
    } catch (err: any) {
      setError(err.message || '刷新失败')
    } finally {
      setRefreshing(false)
    }
  }

  const handleClose = async (symbol: string) => {
    if (closingSymbol) return
    setClosingSymbol(symbol)
    try {
      await closeLivePosition(symbol)
      const data = await refreshLiveAccount()
      setStatus(data)
      onStatusChange?.(data)
    } catch (err: any) {
      setError(err.message || '平仓失败')
    } finally {
      setClosingSymbol(null)
    }
  }

  const handleReconnect = () => {
    setError(null)
    setStatus((prev) => prev ? { ...prev, last_error: null } : null)
  }

  if (loading) {
    return (
      <main className={inline ? 'text-text-primary' : 'min-h-screen bg-gradient-to-b from-[#020617] to-[#0f172a] p-8 px-6 text-text-primary'}>
        <div className="flex items-center justify-center min-h-[60vh] text-[15px] text-text-muted">正在加载实盘账户…</div>
      </main>
    )
  }

  const connected = status?.connected ?? false
  const lastError = status?.last_error ?? error

  const Wrapper = inline ? 'div' : 'main'
  const wrapperClassName = inline
    ? 'text-text-primary'
    : 'min-h-screen bg-gradient-to-b from-[#020617] to-[#0f172a] p-8 px-6 text-text-primary'

  return (
    <Wrapper className={wrapperClassName}>
      <Card className="max-w-[1120px] mx-auto rounded-3xl border-border bg-bg-card shadow-2xl p-8 gap-6">
        <CardContent className="p-0 grid gap-6">
          {/* Header */}
          {!inline && (
            <div className="flex justify-between items-start">
              <div>
                <div className="text-xs tracking-[0.18em] uppercase text-text-secondary mb-3">Gate Futures Live</div>
                <h1 className="m-0 text-[32px] font-bold text-text-primary">合约实盘账户</h1>
              </div>
              <StatusChip connected={connected} error={lastError} />
            </div>
          )}
          {inline && (
            <div className="flex justify-between items-start">
              <StatusChip connected={connected} error={lastError} />
            </div>
          )}

          {/* Error banner */}
          {lastError && (
            <div className="flex justify-between items-center py-3 px-[18px] rounded-[14px] bg-[rgba(127,29,29,0.24)] border border-[rgba(248,113,113,0.28)] text-[#fecaca] text-sm">
              <span>{lastError}</span>
              <Button
                variant="ghost"
                size="sm"
                className="border border-white/8 rounded-lg text-[#e5e7eb] text-xs font-semibold px-3 py-1"
                onClick={handleReconnect}
              >
                知道了
              </Button>
            </div>
          )}

          {/* Not connected: show form */}
          {!connected && !lastError && (
            <div className="max-w-[480px] grid gap-4">
              <p className="m-0 text-sm leading-relaxed text-text-muted">输入 Gate.io 合约 API Key 和 Secret，连接后只读展示账户信息和持仓。</p>
              <Label className="grid gap-1.5">
                <span className="text-xs text-text-muted font-semibold">API Key</span>
                <Input
                  type="text"
                  className="bg-bg-input border-border text-text-primary rounded-xl px-3 py-[11px] h-auto"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="输入 Gate.io API Key"
                  autoComplete="off"
                />
              </Label>
              <Label className="grid gap-1.5">
                <span className="text-xs text-text-muted font-semibold">API Secret</span>
                <Input
                  type="password"
                  className="bg-bg-input border-border text-text-primary rounded-xl px-3 py-[11px] h-auto"
                  value={apiSecret}
                  onChange={(e) => setApiSecret(e.target.value)}
                  placeholder="输入 Gate.io API Secret"
                  autoComplete="off"
                />
              </Label>
              <Button
                className="w-full py-[13px] px-4 rounded-[14px] font-extrabold text-[15px] bg-gradient-to-br from-[#20232a] to-[#2b3038] text-white shadow-lg"
                disabled={!apiKey.trim() || !apiSecret.trim() || connecting}
                onClick={handleConnect}
              >
                {connecting ? '连接中…' : '连接实盘账户'}
              </Button>
            </div>
          )}

          {/* Reconnect form after error */}
          {lastError && !connected && (
            <div className="max-w-[480px] grid gap-4">
              <Label className="grid gap-1.5">
                <span className="text-xs text-text-muted font-semibold">API Key</span>
                <Input
                  type="text"
                  className="bg-bg-input border-border text-text-primary rounded-xl px-3 py-[11px] h-auto"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="输入 Gate.io API Key"
                  autoComplete="off"
                />
              </Label>
              <Label className="grid gap-1.5">
                <span className="text-xs text-text-muted font-semibold">API Secret</span>
                <Input
                  type="password"
                  className="bg-bg-input border-border text-text-primary rounded-xl px-3 py-[11px] h-auto"
                  value={apiSecret}
                  onChange={(e) => setApiSecret(e.target.value)}
                  placeholder="输入 Gate.io API Secret"
                  autoComplete="off"
                />
              </Label>
              <Button
                className="w-full py-[13px] px-4 rounded-[14px] font-extrabold text-[15px] bg-gradient-to-br from-[#20232a] to-[#2b3038] text-white shadow-lg"
                disabled={!apiKey.trim() || !apiSecret.trim() || connecting}
                onClick={handleConnect}
              >
                {connecting ? '连接中…' : '重新连接'}
              </Button>
            </div>
          )}

          {/* Connected: show data */}
          {connected && status?.account && (
            <>
              {/* Account overview */}
              <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3.5">
                <MiniStat label="账户权益" value={fmtNum(status.account.equity)} suffix="USDT" />
                <MiniStat label="可用余额" value={fmtNum(status.account.available_balance)} suffix="USDT" />
                <MiniStat label="已用保证金" value={fmtNum(status.account.margin_used)} suffix="USDT" />
                <MiniStat
                  label="未实现盈亏"
                  value={fmtPnl(status.account.unrealized_pnl)}
                  color={status.account.unrealized_pnl >= 0 ? 'text-accent-green' : 'text-accent-red'}
                />
              </div>

              {/* Positions table */}
              {(() => { const activePositions = status.positions.filter(p => p.size > 0); return (
              <>
              <div className="flex justify-between items-center">
                <h3 className="m-0 text-lg font-bold text-text-primary">当前持仓</h3>
                <span className="text-[13px] text-text-muted">
                  {activePositions.length > 0 ? `${activePositions.length} 个持仓` : '无持仓'}
                </span>
              </div>
              {activePositions.length > 0 && (
                <div className="overflow-x-auto rounded-2xl border border-white/8">
                  <Table className="text-sm">
                    <TableHeader>
                      <TableRow className="border-b-border hover:bg-transparent">
                        <TableHead className="text-[11px] uppercase tracking-[0.06em] text-text-muted font-semibold py-3 px-4">交易对</TableHead>
                        <TableHead className="text-[11px] uppercase tracking-[0.06em] text-text-muted font-semibold py-3 px-4">方向</TableHead>
                        <TableHead className="text-[11px] uppercase tracking-[0.06em] text-text-muted font-semibold py-3 px-4">杠杆</TableHead>
                        <TableHead className="text-[11px] uppercase tracking-[0.06em] text-text-muted font-semibold py-3 px-4">数量</TableHead>
                        <TableHead className="text-[11px] uppercase tracking-[0.06em] text-text-muted font-semibold py-3 px-4">开仓价</TableHead>
                        <TableHead className="text-[11px] uppercase tracking-[0.06em] text-text-muted font-semibold py-3 px-4">标记价</TableHead>
                        <TableHead className="text-[11px] uppercase tracking-[0.06em] text-text-muted font-semibold py-3 px-4">未实现盈亏</TableHead>
                        <TableHead className="text-[11px] uppercase tracking-[0.06em] text-text-muted font-semibold py-3 px-4">操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activePositions.map((pos) => (
                        <TableRow key={`${pos.symbol}-${pos.side}`} className="border-b-border/20 hover:bg-transparent">
                          <TableCell className="py-3 px-4 text-text-primary">{pos.symbol}</TableCell>
                          <TableCell className="py-3 px-4">
                            <span className={pos.side === 'long' ? 'text-accent-green font-bold text-[13px]' : 'text-accent-red font-bold text-[13px]'}>
                              {pos.side === 'long' ? '做多' : '做空'}
                            </span>
                          </TableCell>
                          <TableCell className="py-3 px-4 text-text-primary">{pos.leverage}x</TableCell>
                          <TableCell className="py-3 px-4 text-text-primary">{pos.size}</TableCell>
                          <TableCell className="py-3 px-4 text-text-primary">{fmtNum(pos.entry_price)}</TableCell>
                          <TableCell className="py-3 px-4 text-text-primary">{fmtNum(pos.mark_price)}</TableCell>
                          <TableCell className={`py-3 px-4 ${pos.unrealized_pnl >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                            {fmtPnl(pos.unrealized_pnl)}
                          </TableCell>
                          <TableCell className="py-3 px-4">
                            <Button
                              variant="secondary"
                              size="sm"
                              className="rounded-[10px] bg-[#2b3038] text-white font-bold text-xs px-3.5 py-1.5 border-0 whitespace-nowrap"
                              disabled={closingSymbol === pos.symbol}
                              onClick={() => handleClose(pos.symbol)}
                            >
                              {closingSymbol === pos.symbol ? '平仓中…' : '一键平仓'}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              </>
              )})()}

              {/* Footer */}
              <div className="flex justify-between items-center pt-1">
                <Button
                  variant="outline"
                  className="py-[11px] px-5 rounded-[14px] border-white/8 bg-white/4 text-text-primary font-bold text-sm"
                  disabled={refreshing}
                  onClick={handleRefresh}
                >
                  {refreshing ? '刷新中…' : '刷新数据'}
                </Button>
                {status.last_sync_at && (
                  <span className="text-xs text-text-muted">
                    上次同步：{new Date(status.last_sync_at).toLocaleString('zh-CN')}
                  </span>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </Wrapper>
  )
}

function StatusChip({ connected, error }: { connected: boolean; error: string | null }) {
  if (connected) {
    return <Badge className="text-accent-green bg-[rgba(16,185,129,0.14)] border-transparent font-bold text-[13px] px-3.5 py-1.5 rounded-full">已连接</Badge>
  }
  if (error) {
    return <Badge className="text-accent-red bg-[rgba(239,68,68,0.14)] border-transparent font-bold text-[13px] px-3.5 py-1.5 rounded-full">连接失败</Badge>
  }
  return <Badge variant="outline" className="text-text-muted bg-[rgba(71,85,105,0.2)] border-transparent font-bold text-[13px] px-3.5 py-1.5 rounded-full">未连接</Badge>
}

function MiniStat({ label, value, suffix, color }: { label: string; value: string; suffix?: string; color?: string }) {
  return (
    <div className="grid gap-1.5 py-4 px-[18px] rounded-[20px] bg-bg-card border border-white/8">
      <div className="text-[11px] uppercase tracking-[0.08em] text-text-muted">{label}</div>
      <div className={`text-[22px] font-extrabold ${color ?? 'text-text-primary'}`}>
        {value}{suffix && <span className="text-[13px] font-medium text-text-muted"> {suffix}</span>}
      </div>
    </div>
  )
}

function fmtNum(n: number): string {
  if (Math.abs(n) >= 1) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return n.toFixed(6)
}

function fmtPnl(n: number): string {
  const prefix = n >= 0 ? '+' : ''
  return prefix + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
