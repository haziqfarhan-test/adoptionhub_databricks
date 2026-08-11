import { describe, it, expect } from 'vitest'
import { fmtValue, fmtCell, fmtAxisTick, CHART_COLORS } from '../chartFormatters'

describe('fmtValue', () => {
  it('returns em dash for null', () => {
    expect(fmtValue(null)).toBe('—')
    expect(fmtValue(undefined)).toBe('—')
  })

  it('returns string representation for non-numbers', () => {
    expect(fmtValue('hello')).toBe('hello')
    expect(fmtValue(true)).toBe('true')
  })

  it('formats billions', () => {
    expect(fmtValue(2_500_000_000)).toBe('2.50B')
  })

  it('formats millions', () => {
    expect(fmtValue(1_200_000)).toBe('1.20M')
  })

  it('formats thousands', () => {
    expect(fmtValue(5_300)).toBe('5.3K')
  })

  it('formats small integers without shorthand', () => {
    expect(fmtValue(999)).toBe('999')
    expect(fmtValue(42)).toBe('42')
  })

  it('formats decimals to 2 places', () => {
    expect(fmtValue(3.14159)).toBe('3.14')
  })

  it('adds $ prefix for money labels', () => {
    expect(fmtValue(5000, 'total_amount')).toBe('$5.0K')
    expect(fmtValue(5000, 'revenue')).toBe('$5.0K')
  })

  it('does not add $ for non-money labels', () => {
    expect(fmtValue(5000, 'employee_count')).toBe('5.0K')
  })
})

describe('fmtCell', () => {
  it('returns em dash for null/undefined', () => {
    expect(fmtCell(null)).toBe('—')
    expect(fmtCell(undefined)).toBe('—')
  })

  it('formats integers with locale separators', () => {
    expect(fmtCell(42)).toBe('42')
    expect(fmtCell(1000)).toBe('1,000')
  })

  it('formats decimals to 2 places', () => {
    expect(fmtCell(3.14159)).toBe('3.14')
  })

  it('truncates ISO datetime strings to date', () => {
    expect(fmtCell('2024-06-15T10:30:00')).toBe('2024-06-15')
  })

  it('passes through short strings unchanged', () => {
    expect(fmtCell('hello')).toBe('hello')
  })
})

describe('fmtAxisTick', () => {
  it('truncates ISO datetime strings to date', () => {
    expect(fmtAxisTick('2024-06-15T10:30:00')).toBe('2024-06-15')
  })

  it('truncates long strings with ellipsis', () => {
    const long = 'A very long category label'
    const result = fmtAxisTick(long)
    expect(result.endsWith('…')).toBe(true)
    expect(result.length).toBeLessThanOrEqual(13)
  })

  it('passes through short strings unchanged', () => {
    expect(fmtAxisTick('Short')).toBe('Short')
    expect(fmtAxisTick(42)).toBe(42)
  })
})

describe('CHART_COLORS', () => {
  it('exports an array of hex color strings', () => {
    expect(Array.isArray(CHART_COLORS)).toBe(true)
    expect(CHART_COLORS.length).toBeGreaterThan(0)
    CHART_COLORS.forEach(c => expect(c).toMatch(/^#[0-9A-Fa-f]{6}$/))
  })
})
