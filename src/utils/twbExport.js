export function rowsToCsv(rows) {
  if (!rows?.length) return ''
  const cols   = Object.keys(rows[0])
  const header = cols.join(',')
  const body   = rows.map(r =>
    cols.map(c => {
      const v = r[c]
      if (v === null || v === undefined) return ''
      const s = String(v)
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"` : s
    }).join(',')
  )
  return [header, ...body].join('\n')
}

export function downloadBlob(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

export function escapeXml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

export function generateTwb(rows, title) {
  if (!rows?.length) return ''
  const cols  = Object.keys(rows[0])
  const isNum = col => rows.some(r => typeof r[col] === 'number')

  const tsv = [
    cols.join('\t'),
    ...rows.map(r =>
      cols.map(c => String(r[c] ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, ' ')).join('\t')
    ),
  ].join('\n')

  const metaRecords = cols.map((col, i) => `
        <metadata-record class='column'>
          <remote-name>${escapeXml(col)}</remote-name>
          <remote-type>${isNum(col) ? '5' : '7'}</remote-type>
          <local-name>[${escapeXml(col)}]</local-name>
          <parent-name>[data]</parent-name>
          <remote-alias>${escapeXml(col)}</remote-alias>
          <ordinal>${i}</ordinal>
          <local-type>${isNum(col) ? 'real' : 'string'}</local-type>
          <aggregation>${isNum(col) ? 'Sum' : 'Count'}</aggregation>
          <contains-null>true</contains-null>
        </metadata-record>`).join('')

  const colDecls = cols.map(col =>
    isNum(col)
      ? `<column datatype='real' name='[${escapeXml(col)}]' role='measure' type='quantitative'/>`
      : `<column datatype='string' name='[${escapeXml(col)}]' role='dimension' type='nominal'/>`
  ).join('\n      ')

  return `<?xml version='1.0' encoding='utf-8' ?>
<workbook source-build='2023.3.0' source-platform='win' version='18.1' xmlns:user='http://www.tableausoftware.com/xml/user'>
  <datasources>
    <datasource caption='${escapeXml(title)}' inline='true' name='textscan.data' version='18.1'>
      <connection class='textscan' filename='' port='' separator='&#9;'>
        <relation name='data' type='text'>${escapeXml(tsv)}</relation>
        <metadata-records>${metaRecords}
        </metadata-records>
      </connection>
      ${colDecls}
    </datasource>
  </datasources>
  <worksheets>
    <worksheet name='${escapeXml(title)}'>
      <table>
        <view>
          <datasources>
            <datasource caption='${escapeXml(title)}' name='textscan.data'/>
          </datasources>
        </view>
      </table>
    </worksheet>
  </worksheets>
</workbook>`
}
