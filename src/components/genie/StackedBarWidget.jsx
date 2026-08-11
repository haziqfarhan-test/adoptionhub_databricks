import {
  ResponsiveContainer,
  BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'
import { Layers } from 'lucide-react'
import { useIsDark }   from '../../hooks/useIsDark'
import { CHART_COLORS, fmtValue, fmtAxisTick } from '../../utils/chartFormatters'

const humanize = k => (k || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

function StackedTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const total = payload.reduce((s, p) => s + (p.value || 0), 0)
  return (
    <div className="rounded-xl border border-ui/[0.10] bg-dark-900 px-3 py-2.5 shadow-apple text-xs min-w-[150px]">
      <p className="font-semibold text-dark-100 mb-1.5 truncate max-w-[220px]">{fmtAxisTick(label)}</p>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-1.5 text-dark-300">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.fill }} />
          <span className="truncate">{String(p.name).replace(/_/g, ' ')}</span>
          <span className="ml-auto font-semibold text-dark-50 pl-2">{fmtValue(p.value)}</span>
        </div>
      ))}
      <div className="mt-1.5 pt-1.5 border-t border-ui/[0.08] flex justify-between text-dark-400">
        <span>Total</span>
        <span className="font-semibold text-dark-200">{fmtValue(total)}</span>
      </div>
    </div>
  )
}

export function StackedBarWidget({ widget, height = 320 }) {
  const isDark  = useIsDark()
  const gridClr = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.06)'
  const axisClr = isDark ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.40)'
  const { title, data = [], x_key, y_keys = [] } = widget
  const xLabel  = humanize(x_key)
  const yLabel  = 'Value'

  if (!data.length || !x_key) return null

  return (
    <div data-chart-card className="rounded-2xl border border-ui/[0.07] bg-dark-800/40 p-5">
      <div className="flex items-center gap-2 mb-5">
        <Layers size={13} className="text-dark-400 shrink-0" />
        <p className="text-sm font-semibold text-dark-50">{title}</p>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 4, right: 16, left: 16, bottom: 56 }}>
          <CartesianGrid vertical={false} stroke={gridClr} />
          <XAxis
            dataKey={x_key}
            tick={{ fontSize: 10, fill: axisClr }}
            tickLine={false} axisLine={false}
            angle={-35} textAnchor="end" interval={0}
            tickFormatter={fmtAxisTick}
          />
          <YAxis
            tick={{ fontSize: 10, fill: axisClr }}
            tickLine={false} axisLine={false}
            tickFormatter={v => fmtValue(v)} width={56}
            label={{ value: yLabel, angle: -90, position: 'insideLeft', offset: 16, fontSize: 10, fill: axisClr }}
          />
          <Tooltip content={<StackedTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
          <Legend
            verticalAlign="top"
            align="left"
            wrapperStyle={{ fontSize: 11, color: axisClr, paddingBottom: 12 }}
            formatter={v => humanize(v)}
          />
          {y_keys.map((key, i) => (
            <Bar
              key={key}
              dataKey={key}
              stackId="stack"
              fill={CHART_COLORS[i % CHART_COLORS.length]}
              maxBarSize={52}
              radius={i === y_keys.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
