import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie } from 'recharts';

const CHART_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
  'var(--chart-7)',
  'var(--chart-8)',
];

const ERROR_COLORS = [
  'var(--error)',
  'var(--warning)',
  'var(--accent-pink)',
  'var(--chart-6)',
  'var(--chart-7)',
  'var(--chart-5)',
  'var(--chart-8)',
  'var(--info)',
];

type HistoryStats = {
  models: { name: string; fullName: string; count: number; errors: number; color: string }[];
  errorCategories: { name: string; count: number }[];
  modelErrors: { name: string; errors: number; total: number; rate: string; color: string }[];
  users: { name: string; count: number }[];
  nodes: { name: string; count: number }[];
  hours: { hour: string; count: number }[];
};

export function HistoryStatsCharts({
  stats,
  lowPerformanceMode,
}: {
  stats: HistoryStats;
  lowPerformanceMode: boolean;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h4 className="text-sm font-medium text-[var(--text-primary)] mb-3">模型使用排行</h4>
        {stats.models.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)] text-center py-4">暂无数据</p>
        ) : (
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.models} layout="vertical" margin={{ left: 0 }}>
                <XAxis type="number" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} axisLine={false} tickLine={false} width={140} />
                <Tooltip
                  contentStyle={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: 6, fontSize: 12, color: 'var(--text-primary)' }}
                  labelStyle={{ color: 'var(--text-primary)' }}
                  formatter={(value, name) => [value, name === 'count' ? '调用数' : '错误数']}
                />
                <Bar dataKey="count" radius={[0, 4, 4, 0]} isAnimationActive={!lowPerformanceMode}>
                  {stats.models.map((m, i) => (
                    <Cell key={i} fill={m.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {stats.errorCategories.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-[var(--text-primary)] mb-3">错误类型分布</h4>
          <div className="grid grid-cols-2 gap-4">
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={stats.errorCategories}
                    dataKey="count"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={70}
                    label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                    labelLine={false}
                    isAnimationActive={!lowPerformanceMode}
                  >
                    {stats.errorCategories.map((_, i) => (
                      <Cell key={i} fill={ERROR_COLORS[i % ERROR_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: 6, fontSize: 12, color: 'var(--text-primary)' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-1.5">
              {stats.errorCategories.map((cat, i) => (
                <div key={cat.name} className="flex items-center gap-2">
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ background: ERROR_COLORS[i % ERROR_COLORS.length] }}
                  />
                  <span className="flex-1 text-xs text-[var(--text-secondary)]">{cat.name}</span>
                  <span className="text-xs text-[var(--text-muted)] mono">{cat.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {stats.modelErrors.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-[var(--text-primary)] mb-3">各模型异常率</h4>
          <div className="space-y-1.5">
            {stats.modelErrors.map((m) => (
              <div key={m.name} className="flex items-center gap-3 text-xs">
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: m.color }} />
                <span className="w-36 text-[var(--text-secondary)] truncate">{m.name}</span>
                <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[var(--error)]"
                    style={{ width: `${m.rate}%` }}
                  />
                </div>
                <span className="text-[var(--error)] mono w-12 text-right">{m.rate}%</span>
                <span className="text-[var(--text-muted)] mono w-16 text-right">{m.errors}/{m.total}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <ChartSection title="用户排行" data={stats.users} lowPerformanceMode={lowPerformanceMode} />
      <ChartSection title="节点分布" data={stats.nodes} lowPerformanceMode={lowPerformanceMode} />

      <div>
        <h4 className="text-sm font-medium text-[var(--text-primary)] mb-3">小时分布 (24h)</h4>
        <div className="h-40">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stats.hours}>
              <XAxis dataKey="hour" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} axisLine={false} tickLine={false} width={30} />
              <Tooltip
                contentStyle={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: 6, fontSize: 12, color: 'var(--text-primary)' }}
                labelStyle={{ color: 'var(--text-primary)' }}
                itemStyle={{ color: 'var(--accent-purple)' }}
              />
              <Bar dataKey="count" radius={[3, 3, 0, 0]} isAnimationActive={!lowPerformanceMode}>
                {stats.hours.map((_, i) => (
                  <Cell key={i} fill={i >= 6 && i < 18 ? 'var(--chart-5)' : 'var(--border-hover)'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function ChartSection({ title, data, lowPerformanceMode }: { title: string; data: { name: string; count: number }[]; lowPerformanceMode: boolean }) {
  if (data.length === 0) return null;
  return (
    <div>
      <h4 className="text-sm font-medium text-[var(--text-primary)] mb-3">{title}</h4>
      <div className="h-36">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 0 }}>
            <XAxis type="number" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="name" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} axisLine={false} tickLine={false} width={110} />
            <Tooltip
              contentStyle={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderRadius: 6, fontSize: 12, color: 'var(--text-primary)' }}
              labelStyle={{ color: 'var(--text-primary)' }}
              itemStyle={{ color: 'var(--accent-purple)' }}
            />
            <Bar dataKey="count" radius={[0, 4, 4, 0]} isAnimationActive={!lowPerformanceMode}>
              {data.map((_, i) => (
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
