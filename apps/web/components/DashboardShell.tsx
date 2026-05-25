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
  cyan: { border: 'rgba(34,211,238,0.28)', glow: 'rgba(8,145,178,0.18)', value: '#a5f3fc' },
  blue: { border: 'rgba(59,130,246,0.24)', glow: 'rgba(37,99,235,0.16)', value: '#bfdbfe' },
  green: { border: 'rgba(16,185,129,0.24)', glow: 'rgba(5,150,105,0.16)', value: '#a7f3d0' },
  violet: { border: 'rgba(168,85,247,0.24)', glow: 'rgba(126,34,206,0.16)', value: '#e9d5ff' },
  slate: { border: 'rgba(148,163,184,0.2)', glow: 'rgba(51,65,85,0.18)', value: '#e2e8f0' },
  amber: { border: 'rgba(245,158,11,0.28)', glow: 'rgba(180,83,9,0.18)', value: '#fcd34d' },
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
      <div style={heroMiniLabelStyle}>{label}</div>
      <div style={heroMiniValueStyle}>{value}</div>
    </div>
  )
}

export function SectionHeader({ title, hint }: { title: string; hint: string }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={eyebrowStyle}>Workspace Panel</div>
      <h3 style={sectionTitleStyle}>{title}</h3>
      <p style={sectionHintStyle}>{hint}</p>
    </div>
  )
}
