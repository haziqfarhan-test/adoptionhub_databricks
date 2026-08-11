import {
  ResponsiveContainer,
  PieChart, Pie, Cell, Tooltip, Legend,
} from 'recharts'
import { PieChart as PieIcon } from 'lucide-react'
import { CHART_COLORS, fmtValue, fmtAxisTick } from '../../utils/chartFormatters'

function PieTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const p = payload[0]
  return (
    <div className="rounded-xl border border-ui/[0.10] bg-dark-900 px-3 py-2.5 shadow-apple text-xs min-w-[130px]">
      <p className="font-semibold text-dark-100 mb-1 truncate max-w-[200px]">{fmtAxisTick(p.name)}</p>
      <div className="flex items-center gap-1.5 text-dark-300">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.payload.fill }} />
        <span className="ml-auto font-semibold text-dark-50">{fmtValue(p.value)}</span>
        <span className="text-dark-500">({p.payload.percent != null ? `${(p.payload.percent * 100).toFixed(1)}%` : ''})</span>
      </div>
    </div>
  )
}

function PieLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent }) {
  if (percent < 0.05) return null  // skip labels for tiny slices
  const RADIAN = Math.PI / 180
  const radius = innerRadius + (outerRadius - innerRadius) * 0.55
  const x = cx + radius * Math.cos(-midAngle * RADIAN)
  const y = cy + radius * Math.sin(-midAngle * RADIAN)
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight={600}>
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  )
}

export function PieChartWidget({ widget, height = 320 }) {
  const { title, data = [], x_key, y_keys = [] } = widget
  const measure = y_keys[0]

  if (!data.length || !x_key || !measure) return null

  // Aggregate by x_key in case data wasn't already aggregated
  const aggregated = Object.values(
    data.reduce((acc, row) => {
      const key = String(row[x_key] ?? '')
      if (!acc[key]) acc[key] = { name: key, value: 0 }
      acc[key].value += Number(row[measure] ?? 0)
      return acc
    }, {})
  ).sort((a, b) => b.value - a.value)

  return (
    <div data-chart-card className="rounded-2xl border border-ui/[0.07] bg-dark-800/40 p-5">
      <div className="flex items-center gap-2 mb-5">
        <PieIcon size={13} className="text-dark-400 shrink-0" />
        <p className="text-sm font-semibold text-dark-50">{title}</p>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={aggregated}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            outerRadius={Math.min(height * 0.38, 140)}
            labelLine={false}
            label={<PieLabel />}
          >
            {aggregated.map((_, i) => (
              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip content={<PieTooltip />} />
          <Legend
            verticalAlign="top"
            align="center"
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 11, color: 'rgba(255,255,255,0.40)', paddingBottom: 12 }}
            formatter={v => fmtAxisTick(String(v))}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}
