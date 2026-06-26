import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts';

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

type RankDatum = {
  name: string;
  count: number;
};

type TimeDatum = {
  bucket: string;
  label: string;
  count: number;
};

export function UsageOverviewCharts({
  usageEventsLoading,
  lowPerformanceMode,
  usageChartGranularity,
  chatTopUsersChartData,
  chatTimeDistributionData,
  imageTopUsersChartData,
  imageTimeDistributionData,
  onChatUserClick,
  onChatBucketClick,
  onImageUserClick,
  onImageBucketClick,
}: {
  usageEventsLoading: boolean;
  lowPerformanceMode: boolean;
  usageChartGranularity: 'hour' | 'day' | 'week' | 'month';
  chatTopUsersChartData: RankDatum[];
  chatTimeDistributionData: TimeDatum[];
  imageTopUsersChartData: RankDatum[];
  imageTimeDistributionData: TimeDatum[];
  onChatUserClick: (userId: string) => void;
  onChatBucketClick: (bucket: string) => void;
  onImageUserClick: (userId: string) => void;
  onImageBucketClick: (bucket: string) => void;
}) {
  return (
    <>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
          <p className="text-sm font-medium text-[var(--text-primary)] mb-1">聊天用量 Top 10 用户</p>
          <p className="text-[11px] text-[var(--text-muted)] mb-3">基于 usage event 的允许事件聚合，按实际聊天用量统计。点击柱子可联动下方事件明细。</p>
          <div className="h-[260px]">
            {usageEventsLoading ? (
              <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">正在读取统一用量事件日志...</div>
            ) : chatTopUsersChartData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">当前没有可用的聊天用量事件。</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chatTopUsersChartData} margin={{ top: 12, right: 12, left: 0, bottom: 18 }}>
                  <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={56} />
                  <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} allowDecimals={false} />
                  <Tooltip cursor={{ fill: 'var(--bg-hover)' }} contentStyle={{ background: 'var(--surface-card-solid)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)' }} />
                  <Bar dataKey="count" radius={[8, 8, 0, 0]} cursor="pointer" isAnimationActive={!lowPerformanceMode} onClick={(data) => onChatUserClick(String(data?.name || ''))}>
                    {chatTopUsersChartData.map((entry, index) => (
                      <Cell key={`${entry.name}-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
          <p className="text-sm font-medium text-[var(--text-primary)] mb-1">聊天时间分布</p>
          <p className="text-[11px] text-[var(--text-muted)] mb-3">{usageChartGranularity === 'hour' ? '按小时看全天哪个时段最忙' : usageChartGranularity === 'day' ? '按天看哪天请求最多' : usageChartGranularity === 'week' ? '按周看哪个自然周最忙' : '按月看哪个月份最忙'}。点击柱子可联动下方事件明细。</p>
          <div className="h-[260px]">
            {usageEventsLoading ? (
              <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">正在读取统一用量事件日志...</div>
            ) : chatTimeDistributionData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">当前没有可用的聊天用量事件。</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chatTimeDistributionData} margin={{ top: 12, right: 12, left: 0, bottom: 18 }}>
                  <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} interval="preserveStartEnd" minTickGap={18} />
                  <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} allowDecimals={false} />
                  <Tooltip cursor={{ fill: 'var(--bg-hover)' }} contentStyle={{ background: 'var(--surface-card-solid)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)' }} />
                  <Bar dataKey="count" fill="var(--chart-3)" radius={[8, 8, 0, 0]} cursor="pointer" isAnimationActive={!lowPerformanceMode} onClick={(data) => onChatBucketClick(String(data?.payload?.bucket || ''))} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
          <p className="text-sm font-medium text-[var(--text-primary)] mb-1">图像用量 Top 10 用户</p>
          <p className="text-[11px] text-[var(--text-muted)] mb-3">按生图和修图实际扣减的额度数量统计，同样来自 usage event。点击柱子可联动下方事件明细。</p>
          <div className="h-[260px]">
            {usageEventsLoading ? (
              <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">正在读取统一用量事件日志...</div>
            ) : imageTopUsersChartData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">当前没有可用的图像用量事件。</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={imageTopUsersChartData} margin={{ top: 12, right: 12, left: 0, bottom: 18 }}>
                  <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={56} />
                  <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} allowDecimals={false} />
                  <Tooltip cursor={{ fill: 'var(--bg-hover)' }} contentStyle={{ background: 'var(--surface-card-solid)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)' }} />
                  <Bar dataKey="count" radius={[8, 8, 0, 0]} cursor="pointer" isAnimationActive={!lowPerformanceMode} onClick={(data) => onImageUserClick(String(data?.name || ''))}>
                    {imageTopUsersChartData.map((entry, index) => (
                      <Cell key={`${entry.name}-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
          <p className="text-sm font-medium text-[var(--text-primary)] mb-1">图像时间分布</p>
          <p className="text-[11px] text-[var(--text-muted)] mb-3">{usageChartGranularity === 'hour' ? '按小时看哪个时段图像调用最密集' : usageChartGranularity === 'day' ? '按天看哪天图像调用最多' : usageChartGranularity === 'week' ? '按周看哪个自然周图像调用最多' : '按月看哪个月份图像调用最多'}。点击柱子可联动下方事件明细。</p>
          <div className="h-[260px]">
            {usageEventsLoading ? (
              <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">正在读取统一用量事件日志...</div>
            ) : imageTimeDistributionData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">当前没有可用的图像用量事件。</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={imageTimeDistributionData} margin={{ top: 12, right: 12, left: 0, bottom: 18 }}>
                  <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} interval="preserveStartEnd" minTickGap={18} />
                  <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} allowDecimals={false} />
                  <Tooltip cursor={{ fill: 'var(--bg-hover)' }} contentStyle={{ background: 'var(--surface-card-solid)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)' }} />
                  <Bar dataKey="count" fill="var(--chart-5)" radius={[8, 8, 0, 0]} cursor="pointer" isAnimationActive={!lowPerformanceMode} onClick={(data) => onImageBucketClick(String(data?.payload?.bucket || ''))} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
