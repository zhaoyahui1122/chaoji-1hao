import type React from 'react'

export const plainStateStyle: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
  background: '#05070b',
  color: '#f3f4f6',
  fontFamily: 'Inter, Arial, sans-serif',
}

export const shellStyle: React.CSSProperties = {
  minHeight: '100vh',
  background: `
    radial-gradient(circle at top, rgba(255,255,255,0.03) 0%, rgba(5,7,11,0) 26%),
    linear-gradient(180deg, #05070b 0%, #090a0d 38%, #0b0c10 100%)
  `,
  color: '#f3f4f6',
  fontFamily: 'Inter, Arial, sans-serif',
}

export const shellGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '320px minmax(0, 1fr)',
  gridTemplateRows: '1fr',
  gap: 22,
  padding: 22,
  height: '100vh',
  overflow: 'hidden',
}

export const sidebarStyle: React.CSSProperties = {
  position: 'sticky',
  top: 22,
  display: 'grid',
  gap: 20,
  padding: 20,
  borderRadius: 28,
  background: 'linear-gradient(180deg, rgba(12,14,18,0.98) 0%, rgba(9,11,15,0.99) 46%, rgba(6,8,12,1) 100%)',
  border: '1px solid rgba(255,255,255,0.08)',
  boxShadow: '0 32px 80px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05)',
  maxHeight: 'calc(100vh - 44px)',
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
  borderRadius: 20,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontWeight: 900,
  letterSpacing: '0.08em',
  color: '#f9fafb',
  background: 'linear-gradient(135deg, #17191d 0%, #22252b 100%)',
  boxShadow: '0 14px 32px rgba(0,0,0,0.28)',
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
  color: '#9ca3af',
}

export const eyebrowStyle: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: '#d1d5db',
}

export const sidebarStatStackStyle: React.CSSProperties = {
  display: 'grid',
  gap: 10,
}

export const sidebarMetricCardStyle: React.CSSProperties = {
  display: 'grid',
  gap: 6,
  padding: '15px 16px',
  borderRadius: 18,
  background: 'linear-gradient(180deg, rgba(18,21,28,0.94) 0%, rgba(12,15,20,0.92) 100%)',
}

export const sidebarMetricLabelStyle: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#9ca3af',
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
  color: '#e5e7eb',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
}

export const navListStyle: React.CSSProperties = {
  display: 'grid',
  gap: 10,
}

export const navButtonStyle: React.CSSProperties = {
  display: 'grid',
  gap: 7,
  padding: '15px 15px 14px',
  borderRadius: 18,
  textAlign: 'left',
  cursor: 'pointer',
  transition: 'all 0.2s ease',
  color: '#f3f4f6',
}

export const navEyebrowStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#d1d5db',
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
  color: '#9ca3af',
}

export const contentStyle: React.CSSProperties = {
  display: 'grid',
  gap: 20,
  overflowY: 'auto',
  maxHeight: '100vh',
  paddingBottom: 28,
}

export const heroStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1.2fr) minmax(320px, 0.9fr)',
  gap: 20,
  padding: 28,
  borderRadius: 28,
  background: `
    radial-gradient(circle at top, rgba(255,255,255,0.04) 0%, rgba(17,24,39,0) 22%),
    linear-gradient(135deg, rgba(12,14,18,0.98) 0%, rgba(16,18,22,0.98) 40%, rgba(20,22,27,0.98) 100%)
  `,
  border: '1px solid rgba(255,255,255,0.08)',
  boxShadow: '0 30px 90px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.05)',
}

export const heroPillStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '7px 12px',
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 800,
  color: '#e5e7eb',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.08)',
}

export const heroTitleStyle: React.CSSProperties = {
  margin: '14px 0 0',
  fontSize: 38,
  lineHeight: 1.05,
  color: '#f8fafc',
  letterSpacing: '-0.03em',
}

export const heroDescriptionStyle: React.CSSProperties = {
  margin: '12px 0 0',
  fontSize: 15,
  lineHeight: 1.7,
  color: '#9ca3af',
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
  padding: '16px 16px',
  borderRadius: 18,
  background: 'linear-gradient(180deg, rgba(18,21,28,0.96) 0%, rgba(12,15,20,0.92) 100%)',
  border: '1px solid rgba(255,255,255,0.08)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)',
}

export const heroMiniLabelStyle: React.CSSProperties = {
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: '#9ca3af',
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
  padding: 20,
  borderRadius: 24,
  background: 'linear-gradient(180deg, rgba(15,17,22,0.96) 0%, rgba(10,12,16,0.98) 100%)',
  border: '1px solid rgba(255,255,255,0.08)',
  boxShadow: '0 24px 50px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.04)',
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
  color: '#9ca3af',
}

export const strategyBannerStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1.15fr) minmax(320px, 0.85fr)',
  gap: 18,
  padding: 22,
  borderRadius: 24,
  background: 'linear-gradient(135deg, rgba(14,16,20,0.99) 0%, rgba(22,25,30,0.98) 40%, rgba(28,31,36,0.98) 100%)',
  border: '1px solid rgba(255,255,255,0.08)',
  boxShadow: '0 22px 54px rgba(0,0,0,0.25)',
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
  color: 'rgba(229,231,235,0.82)',
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

export const rightRailStackStyle: React.CSSProperties = {
  display: 'grid',
  gap: 16,
  alignContent: 'start',
}
