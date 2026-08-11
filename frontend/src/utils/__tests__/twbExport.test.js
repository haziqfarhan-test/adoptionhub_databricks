import { describe, it, expect, vi } from 'vitest'
import { rowsToCsv, escapeXml, generateTwb, downloadBlob } from '../twbExport'

describe('rowsToCsv', () => {
  it('returns empty string for empty/null input', () => {
    expect(rowsToCsv([])).toBe('')
    expect(rowsToCsv(null)).toBe('')
    expect(rowsToCsv(undefined)).toBe('')
  })

  it('produces correct header and rows', () => {
    const rows = [
      { name: 'Alice', count: 5 },
      { name: 'Bob',   count: 3 },
    ]
    const csv = rowsToCsv(rows)
    const lines = csv.split('\n')
    expect(lines[0]).toBe('name,count')
    expect(lines[1]).toBe('Alice,5')
    expect(lines[2]).toBe('Bob,3')
  })

  it('wraps values containing commas in quotes', () => {
    const rows = [{ label: 'one, two', value: 1 }]
    const csv = rowsToCsv(rows)
    expect(csv).toContain('"one, two"')
  })

  it('escapes double-quotes inside values', () => {
    const rows = [{ label: 'say "hi"', value: 1 }]
    const csv = rowsToCsv(rows)
    expect(csv).toContain('"say ""hi"""')
  })

  it('handles null/undefined cell values', () => {
    const rows = [{ a: null, b: undefined, c: 'ok' }]
    const csv = rowsToCsv(rows)
    expect(csv.split('\n')[1]).toBe(',,ok')
  })
})

describe('escapeXml', () => {
  it('escapes ampersands', () => {
    expect(escapeXml('a & b')).toBe('a &amp; b')
  })

  it('escapes angle brackets', () => {
    expect(escapeXml('<tag>')).toBe('&lt;tag&gt;')
  })

  it('escapes double quotes', () => {
    expect(escapeXml('"value"')).toBe('&quot;value&quot;')
  })

  it('escapes single quotes', () => {
    expect(escapeXml("it's")).toBe("it&apos;s")
  })

  it('handles null/undefined by treating as empty string', () => {
    expect(escapeXml(null)).toBe('')
    expect(escapeXml(undefined)).toBe('')
  })
})

describe('generateTwb', () => {
  it('returns empty string for empty/null rows', () => {
    expect(generateTwb([], 'test')).toBe('')
    expect(generateTwb(null, 'test')).toBe('')
  })

  it('produces XML starting with declaration', () => {
    const rows = [{ stage: 'A', count: 5 }]
    const result = generateTwb(rows, 'Test Dashboard')
    expect(result).toMatch(/^<\?xml/)
  })

  it('includes the title in the workbook', () => {
    const rows = [{ stage: 'A', count: 5 }]
    const result = generateTwb(rows, 'My Dashboard')
    expect(result).toContain('My Dashboard')
  })

  it('marks numeric columns as real/measure and string as string/dimension', () => {
    const rows = [{ name: 'Alice', score: 42 }]
    const result = generateTwb(rows, 'test')
    expect(result).toContain("datatype='real'")
    expect(result).toContain("role='measure'")
    expect(result).toContain("datatype='string'")
    expect(result).toContain("role='dimension'")
  })
})

describe('downloadBlob', () => {
  it('creates and clicks an anchor element then revokes the URL', () => {
    const mockUrl = 'blob:mock-url'
    const mockClick = vi.fn()
    const mockRevoke = vi.fn()

    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => mockUrl),
      revokeObjectURL: mockRevoke,
    })

    const anchorSpy = { href: '', download: '', click: mockClick }
    vi.spyOn(document, 'createElement').mockReturnValueOnce(anchorSpy)

    downloadBlob('content', 'file.csv', 'text/csv')

    expect(anchorSpy.href).toBe(mockUrl)
    expect(anchorSpy.download).toBe('file.csv')
    expect(mockClick).toHaveBeenCalled()
    expect(mockRevoke).toHaveBeenCalledWith(mockUrl)

    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })
})
