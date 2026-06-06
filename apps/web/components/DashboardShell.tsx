import type React from 'react'
import {
  sidebarMetricCardStyle,
  sidebarMetricLabelStyle,
  sidebarMetricValueStyle,
  heroMiniStatStyle,
  heroMiniLabelStyle,
  heroMiniValueStyle,
  sectionTitleStyle,
  sectionHintStyle,
  eyebrowStyle,
} from './dashboard-layout-styles'

type Tone = 'cyan' | 'blue' | 'green' | 'violet' | 'slate' | 'amber'

const toneMap: Record<Tone, { border: string; glow: string; value: string }> = {
  cyan: { border: 'rgba(255,255,255,0.08)', glow: 'rgba(0,0,0,0.18)', value: '#f3f4f6' },
  blue: { border: 'rgba(255,255,255,0.08)', glow: 'rgba(0,0,0,0.18)', value: '#f3f4f6' },
  green: { border: 'rgba(34,197,94,0.2)', glow: 'rgba(0,0,0,0.18)', value: '#4ade80' },
  violet: { border: 'rgba(255,255,255,0.08)', glow: 'rgba(0,0,0,0.18)', value: '#f3f4f6' },
  slate: { border: 'rgba(255,255,255,0.08)', glow: 'rgba(0,0,0,0.18)', value: '#e5e7eb' },
  amber: { border: 'rgba(255,255,255,0.08)', glow: 'rgba(0,0,0,0.18)', value: '#f3f4f6' },
}

export function MetricCard({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  const palette = toneMap[tone]
  return (
    <div style={{ ...sidebarMetricCardStyle, border: `1px solid ${palette.border}`, boxShadow: `inset 0 0 0 1px rgba(255,255,255,0.02), 0 14px 28px ${palette.glow}` }}>
      <div style={sidebarMetricLabelStyle}>{label}</div>
      <div style={{ ...sidebarMetricValueStyle, color: palette.value }}>{value}</div>
    </div>
  )
}

export function HeroMiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={heroMiniStatStyle}>
      <div style={{ ...heroMiniLabelStyle, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: 999, background: '#6b7280' }} />
        {label}
      </div>
      <div style={heroMiniValueStyle}>{value}</div>
    </div>
  )
}

export function SectionHeader({ title, hint }: { title: string; hint: string }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={eyebrowStyle}>Workspace Panel</div>
      <h3 style={sectionTitleStyle}>{title}</h3>
      <p style={sectionHintStyle}>{hint}</p>
    </div>
  )
}
