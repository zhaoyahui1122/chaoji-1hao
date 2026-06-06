"use client"

import { useCallback, useEffect, useRef, useState } from 'react'
import type React from 'react'
import {
  closeLivePosition,
  connectLiveAccount,
  getLiveAccountStatus,
  refreshLiveAccount,
  type LiveAccountStatus,
} from '../lib/api'

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
      <main style={inline ? inlineShellStyle : shellStyle}>
        <div style={centerStyle}>正在加载实盘账户…</div>
      </main>
    )
  }

  const connected = status?.connected ?? false
  const lastError = status?.last_error ?? error

  const Wrapper = inline ? 'div' : 'main'
  const wrapperStyle = inline ? inlineShellStyle : shellStyle

  return (
    <Wrapper style={wrapperStyle}>
      <section style={panelStyle}>
        {/* Header */}
        {!inline && (
          <div style={headerRowStyle}>
            <div>
              <div style={eyebrowStyle}>Gate Futures Live</div>
              <h1 style={titleStyle}>合约实盘账户</h1>
            </div>
            <StatusChip connected={connected} error={lastError} />
          </div>
        )}
        {inline && (
          <div style={headerRowStyle}>
            <StatusChip connected={connected} error={lastError} />
          </div>
        )}

        {/* Error banner */}
        {lastError && (
          <div style={errorBannerStyle}>
            <span>{lastError}</span>
            <button style={errorDismissStyle} onClick={handleReconnect}>知道了</button>
          </div>
        )}

        {/* Not connected: show form */}
        {!connected && !lastError && (
          <div style={formWrapperStyle}>
            <p style={formDescStyle}>输入 Gate.io 合约 API Key 和 Secret，连接后只读展示账户信息和持仓。</p>
            <label style={fieldLabelStyle}>
              <span style={labelSpanStyle}>API Key</span>
              <input
                type="text"
                style={inputStyle}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="输入 Gate.io API Key"
                autoComplete="off"
              />
            </label>
            <label style={fieldLabelStyle}>
              <span style={labelSpanStyle}>API Secret</span>
              <input
                type="password"
                style={inputStyle}
                value={apiSecret}
                onChange={(e) => setApiSecret(e.target.value)}
                placeholder="输入 Gate.io API Secret"
                autoComplete="off"
              />
            </label>
            <button
              style={{
                ...primaryButtonStyle,
                ...((!apiKey.trim() || !apiSecret.trim() || connecting) ? disabledStyle : {}),
              }}
              disabled={!apiKey.trim() || !apiSecret.trim() || connecting}
              onClick={handleConnect}
            >
              {connecting ? '连接中…' : '连接实盘账户'}
            </button>
          </div>
        )}

        {/* Reconnect form after error */}
        {lastError && !connected && (
          <div style={formWrapperStyle}>
            <label style={fieldLabelStyle}>
              <span style={labelSpanStyle}>API Key</span>
              <input
                type="text"
                style={inputStyle}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="输入 Gate.io API Key"
                autoComplete="off"
              />
            </label>
            <label style={fieldLabelStyle}>
              <span style={labelSpanStyle}>API Secret</span>
              <input
                type="password"
                style={inputStyle}
                value={apiSecret}
                onChange={(e) => setApiSecret(e.target.value)}
                placeholder="输入 Gate.io API Secret"
                autoComplete="off"
              />
            </label>
            <button
              style={{
                ...primaryButtonStyle,
                ...((!apiKey.trim() || !apiSecret.trim() || connecting) ? disabledStyle : {}),
              }}
              disabled={!apiKey.trim() || !apiSecret.trim() || connecting}
              onClick={handleConnect}
            >
              {connecting ? '连接中…' : '重新连接'}
            </button>
          </div>
        )}

        {/* Connected: show data */}
        {connected && status?.account && (
          <>
            {/* Account overview */}
            <div style={statsGridStyle}>
              <MiniStat label="账户权益" value={fmtNum(status.account.equity)} suffix="USDT" />
              <MiniStat label="可用余额" value={fmtNum(status.account.available_balance)} suffix="USDT" />
              <MiniStat label="已用保证金" value={fmtNum(status.account.margin_used)} suffix="USDT" />
              <MiniStat
                label="未实现盈亏"
                value={fmtPnl(status.account.unrealized_pnl)}
                color={status.account.unrealized_pnl >= 0 ? '#86efac' : '#fca5a5'}
              />
            </div>

            {/* Positions table */}
            {(() => { const activePositions = status.positions.filter(p => p.size > 0); return (
            <>
            <div style={tableHeaderStyle}>
              <h3 style={sectionTitleStyle}>当前持仓</h3>
              <span style={positionCountStyle}>
                {activePositions.length > 0 ? `${activePositions.length} 个持仓` : '无持仓'}
              </span>
            </div>
            {activePositions.length > 0 && (
              <div style={tableWrapperStyle}>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={thStyle}>交易对</th>
                      <th style={thStyle}>方向</th>
                      <th style={thStyle}>杠杆</th>
                      <th style={thStyle}>数量</th>
                      <th style={thStyle}>开仓价</th>
                      <th style={thStyle}>标记价</th>
                      <th style={thStyle}>未实现盈亏</th>
                      <th style={thStyle}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activePositions.map((pos) => (
                      <tr key={`${pos.symbol}-${pos.side}`} style={trStyle}>
                        <td style={tdStyle}>{pos.symbol}</td>
                        <td style={tdStyle}>
                          <span style={pos.side === 'long' ? sideLongStyle : sideShortStyle}>
                            {pos.side === 'long' ? '做多' : '做空'}
                          </span>
                        </td>
                        <td style={tdStyle}>{pos.leverage}x</td>
                        <td style={tdStyle}>{pos.size}</td>
                        <td style={tdStyle}>{fmtNum(pos.entry_price)}</td>
                        <td style={tdStyle}>{fmtNum(pos.mark_price)}</td>
                        <td style={{ ...tdStyle, color: pos.unrealized_pnl >= 0 ? '#86efac' : '#fca5a5' }}>
                          {fmtPnl(pos.unrealized_pnl)}
                        </td>
                        <td style={tdStyle}>
                          <button
                            style={{
                              ...closeButtonStyle,
                              ...(closingSymbol === pos.symbol ? disabledStyle : {}),
                            }}
                            disabled={closingSymbol === pos.symbol}
                            onClick={() => handleClose(pos.symbol)}
                          >
                            {closingSymbol === pos.symbol ? '平仓中…' : '一键平仓'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            </>
            )})()}

            {/* Footer */}
            <div style={footerStyle}>
              <button
                style={{
                  ...secondaryButtonStyle,
                  ...(refreshing ? disabledStyle : {}),
                }}
                disabled={refreshing}
                onClick={handleRefresh}
              >
                {refreshing ? '刷新中…' : '刷新数据'}
              </button>
              {status.last_sync_at && (
                <span style={syncTimeStyle}>
                  上次同步：{new Date(status.last_sync_at).toLocaleString('zh-CN')}
                </span>
              )}
            </div>
          </>
        )}
      </section>
    </Wrapper>
  )
}

function StatusChip({ connected, error }: { connected: boolean; error: string | null }) {
  if (connected) {
    return <span style={{ ...chipBaseStyle, color: '#86efac', background: 'rgba(16,185,129,0.14)' }}>已连接</span>
  }
  if (error) {
    return <span style={{ ...chipBaseStyle, color: '#fca5a5', background: 'rgba(239,68,68,0.14)' }}>连接失败</span>
  }
  return <span style={{ ...chipBaseStyle, color: '#94a3b8', background: 'rgba(71,85,105,0.2)' }}>未连接</span>
}

function MiniStat({ label, value, suffix, color }: { label: string; value: string; suffix?: string; color?: string }) {
  return (
    <div style={miniStatCardStyle}>
      <div style={miniStatLabelStyle}>{label}</div>
      <div style={{ ...miniStatValueStyle, ...(color ? { color } : {}) }}>
        {value}{suffix && <span style={miniStatSuffixStyle}> {suffix}</span>}
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

// ── Styles ──

const shellStyle: React.CSSProperties = {
  minHeight: '100vh',
  background: 'linear-gradient(180deg, #020617 0%, #0f172a 100%)',
  padding: '32px 24px',
  color: '#e2e8f0',
  fontFamily: 'Inter, Arial, sans-serif',
}

const inlineShellStyle: React.CSSProperties = {
  color: '#e2e8f0',
  fontFamily: 'Inter, Arial, sans-serif',
}

const centerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '60vh',
  fontSize: 15,
  color: '#94a3b8',
}

const panelStyle: React.CSSProperties = {
  maxWidth: 1120,
  margin: '0 auto',
  borderRadius: 24,
  border: '1px solid rgba(51,65,85,0.72)',
  background: 'linear-gradient(180deg, rgba(15,23,42,0.88) 0%, rgba(2,6,23,0.92) 100%)',
  boxShadow: '0 16px 32px rgba(0,0,0,0.18)',
  padding: '32px',
  display: 'grid',
  gap: 24,
}

const headerRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
}

const eyebrowStyle: React.CSSProperties = {
  fontSize: 12,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: '#d1d5db',
  marginBottom: 12,
}

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 32,
  fontWeight: 700,
  color: '#f8fafc',
}

const chipBaseStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  borderRadius: 999,
  padding: '6px 14px',
  fontSize: 13,
  fontWeight: 700,
  whiteSpace: 'nowrap',
}

const errorBannerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '12px 18px',
  borderRadius: 14,
  background: 'rgba(127,29,29,0.24)',
  border: '1px solid rgba(248,113,113,0.28)',
  color: '#fecaca',
  fontSize: 14,
}

const errorDismissStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 8,
  color: '#e5e7eb',
  padding: '5px 12px',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
}

const formWrapperStyle: React.CSSProperties = {
  maxWidth: 480,
  display: 'grid',
  gap: 16,
}

const formDescStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 14,
  lineHeight: 1.6,
  color: '#94a3b8',
}

const fieldLabelStyle: React.CSSProperties = {
  display: 'grid',
  gap: 6,
}

const labelSpanStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#94a3b8',
  fontWeight: 600,
}

const inputStyle: React.CSSProperties = {
  padding: '11px 12px',
  borderRadius: 12,
  border: '1px solid rgba(255,255,255,0.08)',
  background: 'rgba(9,11,15,0.92)',
  color: '#f8fafc',
  fontSize: 14,
  outline: 'none',
}

const primaryButtonStyle: React.CSSProperties = {
  width: '100%',
  padding: '13px 16px',
  borderRadius: 14,
  border: 0,
  background: 'linear-gradient(135deg, #20232a 0%, #2b3038 100%)',
  color: '#fff',
  fontWeight: 800,
  fontSize: 15,
  cursor: 'pointer',
  boxShadow: '0 8px 18px rgba(0,0,0,0.14)',
}

const secondaryButtonStyle: React.CSSProperties = {
  padding: '11px 20px',
  borderRadius: 14,
  border: '1px solid rgba(255,255,255,0.08)',
  background: 'rgba(255,255,255,0.04)',
  color: '#e2e8f0',
  fontWeight: 700,
  fontSize: 14,
  cursor: 'pointer',
}

const disabledStyle: React.CSSProperties = {
  opacity: 0.55,
  cursor: 'not-allowed',
}

const statsGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
  gap: 14,
}

const miniStatCardStyle: React.CSSProperties = {
  display: 'grid',
  gap: 6,
  padding: '16px 18px',
  borderRadius: 20,
  background: 'linear-gradient(180deg, rgba(15,17,22,0.95) 0%, rgba(22,25,30,0.92) 100%)',
  border: '1px solid rgba(255,255,255,0.08)',
}

const miniStatLabelStyle: React.CSSProperties = {
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: '#94a3b8',
}

const miniStatValueStyle: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 800,
  color: '#f8fafc',
}

const miniStatSuffixStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  color: '#64748b',
}

const tableHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
}

const sectionTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 18,
  fontWeight: 700,
  color: '#f8fafc',
}

const positionCountStyle: React.CSSProperties = {
  fontSize: 13,
  color: '#64748b',
}

const tableWrapperStyle: React.CSSProperties = {
  overflowX: 'auto',
  borderRadius: 16,
  border: '1px solid rgba(255,255,255,0.08)',
}

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 14,
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '12px 16px',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: '#64748b',
  fontWeight: 600,
  borderBottom: '1px solid rgba(51,65,85,0.4)',
  whiteSpace: 'nowrap',
}

const tdStyle: React.CSSProperties = {
  padding: '12px 16px',
  color: '#e2e8f0',
  borderBottom: '1px solid rgba(51,65,85,0.2)',
  whiteSpace: 'nowrap',
}

const trStyle: React.CSSProperties = {}

const sideLongStyle: React.CSSProperties = {
  color: '#86efac',
  fontWeight: 700,
  fontSize: 13,
}

const sideShortStyle: React.CSSProperties = {
  color: '#fca5a5',
  fontWeight: 700,
  fontSize: 13,
}

const closeButtonStyle: React.CSSProperties = {
  padding: '6px 14px',
  borderRadius: 10,
  border: 0,
  background: '#2b3038',
  color: '#fff',
  fontWeight: 700,
  fontSize: 12,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

const footerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  paddingTop: 4,
}

const syncTimeStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#64748b',
}
