import { KpiCard }          from './KpiCard'
import { SwitchableWidget } from './ChartWidget'
import { TableWidget }      from './TableWidget'

export function WidgetGrid({ widgets, widgetHeights, setWidgetHeights }) {
  const kpiWidgets   = widgets.filter(w => w.type === 'KPI_CARD')
  const chartWidgets = widgets.filter(w => w.type !== 'KPI_CARD' && w.type !== 'TABLE')
  const tableWidget  = widgets.find(w => w.type === 'TABLE')

  function getH(key)    { return widgetHeights[key] ?? 320 }
  function setH(key, h) { setWidgetHeights(prev => ({ ...prev, [key]: h })) }

  return (
    <div className="space-y-5">
      {/* KPI row — always 4 columns */}
      {kpiWidgets.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {kpiWidgets.map((w, i) => (
            <KpiCard key={i} widget={w} index={i} />
          ))}
        </div>
      )}

      {/* Chart canvas — dot-grid background, switchable type + resizable */}
      {chartWidgets.length > 0 && (
        <div
          className="rounded-2xl p-4 border border-ui/[0.05]"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.032) 1px, transparent 1px)',
            backgroundSize: '20px 20px',
          }}>
          <div className="space-y-4">
            {chartWidgets.map((w, i) => (
              <SwitchableWidget
                key={i}
                widget={w}
                height={getH(`chart_${i}`)}
                onHeightChange={h => setH(`chart_${i}`, h)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Full data table */}
      {tableWidget && (
        <TableWidget
          widget={tableWidget}
          height={getH('table')}
          onHeightChange={h => setH('table', h)}
        />
      )}
    </div>
  )
}
