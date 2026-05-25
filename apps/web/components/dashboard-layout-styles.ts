import type React from 'react'

export const plainStateStyle: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
  background: '#020617',
  color: '#e2e8f0',
  fontFamily: 'Inter, Arial, sans-serif',
}

export const shellStyle: React.CSSProperties = {
  minHeight: '100vh',
  background: 'radial-gradient(circle at top left, rgba(14,165,233,0.16) 0%, rgba(2,6,23,0.95) 28%, #020617 62%, #020617 100%)',
  color: '#e2e8f0',
  fontFamily: 'Inter, Arial, sans-serif',
}

export const shellGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '300px minmax(0, 1fr)',
  gridTemplateRows: '1fr',
  gap: 20,
  padding: 20,
  height: '100vh',
  overflow: 'hidden',
}

export const sidebarStyle: React.CSSProperties = {
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

export const brandWrapStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '56px 1fr',
  gap: 14,
  alignItems: 'start',
}

export const brandBadgeStyle: React.CSSProperties = {
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

export const brandTitleStyle: React.CSSProperties = {
  margin: '4px 0 0',
  fontSize: 24,
  color: '#f8fafc',
}

export const brandSubtleStyle: React.CSSProperties = {
  margin: '8px 0 0',
  fontSize: 13,
  lineHeight: 1.65,
  color: '#94a3b8',
}

export const eyebrowStyle: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: '#38bdf8',
}

export const sidebarStatStackStyle: React.CSSProperties = {
  display: 'grid',
  gap: 10,
}

export const sidebarMetricCardStyle: React.CSSProperties = {
  display: 'grid',
  gap: 6,
  padding: '14px 16px',
  borderRadius: 18,
  background: 'rgba(15,23,42,0.88)',
}

export const sidebarMetricLabelStyle: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#94a3b8',
}

export const sidebarMetricValueStyle: React.CSSProperties = {
  fontSize: 19,
  fontWeight: 800,
}

export const navSectionStyle: React.CSSProperties = {
  display: 'grid',
  gap: 10,
}

export const navSectionTitleStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 800,
  color: '#cbd5e1',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
}

export const navListStyle: React.CSSProperties = {
  display: 'grid',
  gap: 10,
}

export const navButtonStyle: React.CSSProperties = {
  display: 'grid',
  gap: 6,
  padding: '14px 14px 13px',
  borderRadius: 18,
  textAlign: 'left',
  cursor: 'pointer',
  transition: 'all 0.2s ease',
  color: '#e2e8f0',
}

export const navEyebrowStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#38bdf8',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
}

export const navLabelStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 800,
  color: '#f8fafc',
}

export const navDescStyle: React.CSSProperties = {
  fontSize: 12,
  lineHeight: 1.6,
  color: '#94a3b8',
}

export const contentStyle: React.CSSProperties = {
  display: 'grid',
  gap: 18,
  overflowY: 'auto',
  maxHeight: '100vh',
  paddingBottom: 20,
}

export const heroStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1.2fr) minmax(320px, 0.9fr)',
  gap: 18,
  padding: 24,
  borderRadius: 30,
  background: 'linear-gradient(135deg, rgba(15,23,42,0.92) 0%, rgba(15,23,42,0.95) 35%, rgba(30,41,59,0.95) 100%)',
  border: '1px solid rgba(51,65,85,0.8)',
  boxShadow: '0 28px 80px rgba(2,8,23,0.42)',
}

export const heroPillStyle: React.CSSProperties = {
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

export const heroTitleStyle: React.CSSProperties = {
  margin: '14px 0 0',
  fontSize: 34,
  lineHeight: 1.05,
  color: '#f8fafc',
  letterSpacing: '-0.03em',
}

export const heroDescriptionStyle: React.CSSProperties = {
  margin: '12px 0 0',
  fontSize: 15,
  lineHeight: 1.7,
  color: '#94a3b8',
  maxWidth: 760,
}

export const heroRightGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 12,
  alignSelf: 'stretch',
}

export const heroMiniStatStyle: React.CSSProperties = {
  display: 'grid',
  gap: 6,
  padding: '14px 16px',
  borderRadius: 20,
  background: 'linear-gradient(180deg, rgba(15,23,42,0.95) 0%, rgba(30,41,59,0.92) 100%)',
  border: '1px solid rgba(71,85,105,0.55)',
}

export const heroMiniLabelStyle: React.CSSProperties = {
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: '#94a3b8',
}

export const heroMiniValueStyle: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 800,
  color: '#f8fafc',
}

export const sectionStackStyle: React.CSSProperties = {
  display: 'grid',
  gap: 16,
}

export const darkPanelStyle: React.CSSProperties = {
  padding: 18,
  borderRadius: 24,
  background: 'linear-gradient(180deg, rgba(15,23,42,0.88) 0%, rgba(2,6,23,0.92) 100%)',
  border: '1px solid rgba(51,65,85,0.72)',
  boxShadow: '0 18px 44px rgba(2,8,23,0.28)',
}

export const sectionTitleStyle: React.CSSProperties = {
  margin: '6px 0 0',
  fontSize: 22,
  color: '#f8fafc',
}

export const sectionHintStyle: React.CSSProperties = {
  margin: '8px 0 0',
  fontSize: 13,
  lineHeight: 1.6,
  color: '#94a3b8',
}

export const strategyBannerStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1.15fr) minmax(320px, 0.85fr)',
  gap: 18,
  padding: 20,
  borderRadius: 26,
  background: 'linear-gradient(135deg, rgba(30,41,59,0.98) 0%, rgba(30,64,175,0.85) 48%, rgba(15,118,110,0.82) 100%)',
  border: '1px solid rgba(125,211,252,0.16)',
}

export const bannerTitleStyle: React.CSSProperties = {
  margin: '6px 0 0',
  fontSize: 28,
  color: '#f8fafc',
  letterSpacing: '-0.03em',
}

export const bannerTextStyle: React.CSSProperties = {
  margin: '10px 0 0',
  fontSize: 14,
  lineHeight: 1.7,
  color: 'rgba(226,232,240,0.85)',
}

export const bannerStatGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 12,
}

export const twoColWideStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1.3fr) minmax(320px, 0.9fr)',
  gap: 16,
  alignItems: 'start',
}

export const twoColBalancedStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 16,
  alignItems: 'start',
}
