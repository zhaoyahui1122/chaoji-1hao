import type { BacktestRunSettings } from './dashboard-types'

export type BacktestDraftState = {
  backtestDays: number
  backtestStartDate: string
  backtestEndDate: string
  backtestSymbol: 'BTC_USDT' | 'ETH_USDT'
  backtestLeverage: number
}

const backtestDraftStore = new Map<number, BacktestDraftState>()

export function diffDaysInclusive(start: string, end: string): number {
  const startDate = new Date(`${start}T00:00:00`)
  const endDate = new Date(`${end}T00:00:00`)
  const msPerDay = 24 * 60 * 60 * 1000
  return Math.floor((endDate.getTime() - startDate.getTime()) / msPerDay) + 1
}

export function getBacktestDraft(slotId: number, fallback: BacktestDraftState): BacktestDraftState {
  return backtestDraftStore.get(slotId) ?? fallback
}

export function setBacktestDraft(slotId: number, draft: BacktestDraftState) {
  backtestDraftStore.set(slotId, { ...draft })
}

export function buildBacktestSelectionKey(params: {
  backtestDays: number
  backtestStartDate: string
  backtestEndDate: string
  backtestSymbol: 'BTC_USDT' | 'ETH_USDT'
  backtestLeverage: number
}) {
  const hasCustomDates = Boolean(params.backtestStartDate && params.backtestEndDate)
  return JSON.stringify({
    symbol: params.backtestSymbol,
    leverage: params.backtestLeverage,
    backtest_days: hasCustomDates ? diffDaysInclusive(params.backtestStartDate, params.backtestEndDate) : params.backtestDays,
    start_date: hasCustomDates ? params.backtestStartDate : null,
    end_date: hasCustomDates ? params.backtestEndDate : null,
  })
}

export function resolveBacktestRunSelection(params: {
  backtestDays: number
  backtestStartDate: string
  backtestEndDate: string
}): {
  options: BacktestRunSettings
  successLabel: string
} {
  const options: BacktestRunSettings = { backtest_days: params.backtestDays }
  let successLabel = `最近 ${params.backtestDays} 天`

  if (params.backtestStartDate && params.backtestEndDate) {
    const rangeDays = diffDaysInclusive(params.backtestStartDate, params.backtestEndDate)
    options.start_date = params.backtestStartDate
    options.end_date = params.backtestEndDate
    options.backtest_days = rangeDays
    successLabel = `${params.backtestStartDate} ~ ${params.backtestEndDate}`
  }

  return {
    options,
    successLabel,
  }
}
