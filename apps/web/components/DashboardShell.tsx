import { Card } from '@/components/ui/card'

type Tone = 'cyan' | 'blue' | 'green' | 'violet' | 'slate' | 'amber'

const toneColors: Record<Tone, string> = {
  cyan: 'text-accent-cyan',
  blue: 'text-accent-blue',
  green: 'text-accent-green',
  violet: 'text-accent-violet',
  slate: 'text-text-secondary',
  amber: 'text-accent-amber',
}

export function MetricCard({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  return (
    <Card className="bg-bg-card border-border p-3">
      <div className="text-[11px] uppercase tracking-[0.08em] text-text-muted">{label}</div>
      <div className={`mt-1 text-lg font-extrabold ${toneColors[tone]}`}>{value}</div>
    </Card>
  )
}

export function HeroMiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="inline-block h-2 w-2 rounded-full bg-text-muted" />
      <span className="text-text-muted">{label}</span>
      <span className="font-bold text-text-primary">{value}</span>
    </div>
  )
}

export function SectionHeader({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="mb-4">
      <div className="text-[11px] uppercase tracking-[0.08em] text-text-muted">Workspace Panel</div>
      <h3 className="mt-1 text-lg font-extrabold text-text-primary">{title}</h3>
      <p className="mt-1 text-sm text-text-secondary">{hint}</p>
    </div>
  )
}
