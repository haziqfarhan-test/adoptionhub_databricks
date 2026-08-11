import { useState } from 'react'
import {
  ResponsiveContainer,
  BarChart, Bar,
  LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'
import { BarChart2, TrendingUp, Layers, PieChart as PieIcon } from 'lucide-react'
import { useIsDark }       from '../../hooks/useIsDark'
import { CHART_COLORS, fmtValue, fmtAxisTick } from '../../utils/chartFormatters'
import { SizeSelector }    from './SizeSelector'
import { StackedBarWidget } from './StackedBarWidget'
import { PieChartWidget }  from './PieChartWidget'

const CHART_TYPES = [
  { type: 'STACKED_BAR_CHART', icon: Layers,    label: 'Stacked' },
  { type: 'BAR_CHART',         icon: BarChart2,  label: 'Bar'    },
  { type: 'LINE_CHART',        icon: TrendingUp,  label: 'Line'  },
  { type: 'PIE_CHART',         icon: PieIcon,    label: 'Pie'    },
]

// Humanise a snake_case column key → "Sun Ray Leadership Stage"
const humanize = k => (k || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border border-ui/[0.10] bg-dark-900 px-3 py-2.5 shadow-apple text-xs min-w-[120px]">
      <p className="font-semibold text-dark-100 mb-1.5 truncate max-w-[200px]">{fmtAxisTick(label)}</p>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-1.5 text-dark-300">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
          <span className="truncate">{p.name.replace(/_/g, ' ')}</span>
          <span className="ml-auto font-semibold text-dark-50 pl-2">{fmtValue(p.value, p.name)}</span>
        </div>
      ))}
    </div>
  )
}

export function BarChartWidget({ widget, height = 320 }) {
  const isDark  = useIsDark()
  const gridClr = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.06)'
  const axisClr = isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.40)'
  const yKeys   = widget.y_keys || []
  const xLabel  = humanize(widget.x_key)
  const yLabel  = humanize(yKeys[0] || '')

  return (
    <div data-chart-card className="rounded-2xl border border-ui/[0.07] bg-dark-800/40 p-5">
      <div className="flex items-center gap-2 mb-5">
        <BarChart2 size={13} className="text-dark-400 shrink-0" />
        <p className="text-sm font-semibold text-dark-50">{widget.title}</p>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={widget.data} margin={{ top: 4, right: 16, left: 16, bottom: 56 }}>
          <CartesianGrid vertical={false} stroke={gridClr} />
          <XAxis
            dataKey={widget.x_key}
            tick={{ fontSize: 10, fill: axisClr }}
            tickLine={false} axisLine={false}
            angle={-30} textAnchor="end" interval={0}
            tickFormatter={fmtAxisTick}
          />
          <YAxis
            tick={{ fontSize: 10, fill: axisClr }}
            tickLine={false} axisLine={false}
            tickFormatter={v => fmtValue(v, yKeys[0] || '')}
            width={56}
            label={{ value: yLabel, angle: -90, position: 'insideLeft', offset: 16, fontSize: 10, fill: axisClr }}
          />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
          {yKeys.length > 1 && (
            <Legend
              verticalAlign="top" align="left"
              wrapperStyle={{ fontSize: 11, color: axisClr, paddingBottom: 12 }}
              formatter={v => humanize(v)}
            />
          )}
          {yKeys.map((key, i) => (
            <Bar key={key} dataKey={key} fill={CHART_COLORS[i % CHART_COLORS.length]}
              radius={[4, 4, 0, 0]} maxBarSize={48} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function LineChartWidget({ widget, height = 320 }) {
  const isDark  = useIsDark()
  const gridClr = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.06)'
  const axisClr = isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.40)'
  const yKeys   = widget.y_keys || []
  const xLabel  = humanize(widget.x_key)
  const yLabel  = humanize(yKeys[0] || '')

  return (
    <div data-chart-card className="rounded-2xl border border-ui/[0.07] bg-dark-800/40 p-5">
      <div className="flex items-center gap-2 mb-5">
        <TrendingUp size={13} className="text-dark-400 shrink-0" />
        <p className="text-sm font-semibold text-dark-50">{widget.title}</p>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={widget.data} margin={{ top: 4, right: 16, left: 16, bottom: 24 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridClr} />
          <XAxis
            dataKey={widget.x_key}
            tick={{ fontSize: 10, fill: axisClr }}
            tickLine={false} axisLine={false}
            tickFormatter={fmtAxisTick}
          />
          <YAxis
            tick={{ fontSize: 10, fill: axisClr }}
            tickLine={false} axisLine={false}
            tickFormatter={v => fmtValue(v, yKeys[0] || '')}
            width={56}
            label={{ value: yLabel, angle: -90, position: 'insideLeft', offset: 16, fontSize: 10, fill: axisClr }}
          />
          <Tooltip content={<ChartTooltip />} />
          {yKeys.length > 1 && (
            <Legend
              verticalAlign="top" align="left"
              wrapperStyle={{ fontSize: 11, color: axisClr, paddingBottom: 12 }}
              formatter={v => humanize(v)}
            />
          )}
          {yKeys.map((key, i) => (
            <Line key={key} type="monotone" dataKey={key}
              stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2}
              dot={widget.data?.length <= 30} activeDot={{ r: 4 }} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function WidgetRenderer({ widget, height }) {
  switch (widget.type) {
    case 'BAR_CHART':          return <BarChartWidget    widget={widget} height={height} />
    case 'LINE_CHART':         return <LineChartWidget   widget={widget} height={height} />
    case 'STACKED_BAR_CHART':  return <StackedBarWidget  widget={widget} height={height} />
    case 'PIE_CHART':          return <PieChartWidget    widget={widget} height={height} />
    default:                   return null
  }
}

export function SwitchableWidget({ widget, height = 320, onHeightChange }) {
  const canSwitch = widget.x_key && widget.y_keys?.length > 0
  const [chartType, setChartType] = useState(widget.type)

  // Stacked button only appears when the original widget is a stacked bar
  const availableTypes = widget.type === 'STACKED_BAR_CHART'
    ? CHART_TYPES
    : CHART_TYPES.filter(t => t.type !== 'STACKED_BAR_CHART')

  if (!canSwitch) return <WidgetRenderer widget={widget} height={height} />

  return (
    <div>
      <div className="flex items-center justify-end gap-2 mb-2">
        <SizeSelector current={height} onChange={onHeightChange} />
        <div className="w-px h-3 bg-ui/[0.10]" />
        {availableTypes.map(({ type, icon: Icon, label }) => (
          <button
            key={type}
            type="button"
            onClick={() => setChartType(type)}
            aria-pressed={chartType === type}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all duration-150
              ${chartType === type
                ? 'bg-brand-500/[0.15] text-brand-500 border border-brand-500/25'
                : 'bg-dark-800/40 text-dark-400 border border-ui/[0.06] hover:text-dark-200 hover:bg-dark-800/70'
              }`}>
            <Icon size={9} />
            {label}
          </button>
        ))}
      </div>
      <WidgetRenderer widget={{ ...widget, type: chartType }} height={height} />
    </div>
  )
}
