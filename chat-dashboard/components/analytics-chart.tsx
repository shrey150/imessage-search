"use client";

import { useMemo } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { cn } from "@/lib/utils";

export interface ChartConfig {
  chartType: "line" | "bar" | "area" | "pie";
  title: string;
  data: Array<Record<string, unknown>>;
  xKey: string;
  yKey: string;
  xLabel?: string;
  yLabel?: string;
}

interface AnalyticsChartProps {
  config: ChartConfig;
  className?: string;
}

// Color palette for charts - matches a modern dark theme
const COLORS = [
  "#3b82f6", // blue-500
  "#8b5cf6", // violet-500
  "#ec4899", // pink-500
  "#f59e0b", // amber-500
  "#10b981", // emerald-500
  "#06b6d4", // cyan-500
  "#f97316", // orange-500
  "#6366f1", // indigo-500
];

const PRIMARY_COLOR = "#3b82f6";
const GRID_COLOR = "#374151";
const TEXT_COLOR = "#9ca3af";

// Custom tooltip component
function CustomTooltip({ 
  active, 
  payload, 
  label,
  yKey,
}: {
  active?: boolean;
  payload?: Array<{ value: number; name: string; color: string }>;
  label?: string;
  yKey: string;
}) {
  if (!active || !payload || !payload.length) return null;

  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 shadow-lg">
      <p className="mb-1 text-xs text-muted-foreground">{label}</p>
      {payload.map((entry, index) => (
        <p key={index} className="text-sm font-medium" style={{ color: entry.color }}>
          {entry.name || yKey}: {entry.value.toLocaleString()}
        </p>
      ))}
    </div>
  );
}

export function AnalyticsChart({ config, className }: AnalyticsChartProps) {
  const { chartType, title, data, xKey, yKey, xLabel, yLabel } = config;

  // Format data to ensure numeric values
  const formattedData = useMemo(() => {
    return data.map((item) => ({
      ...item,
      [yKey]: typeof item[yKey] === "number" ? item[yKey] : Number(item[yKey]) || 0,
    }));
  }, [data, yKey]);

  const commonAxisProps = {
    tick: { fill: TEXT_COLOR, fontSize: 11 },
    tickLine: { stroke: GRID_COLOR },
    axisLine: { stroke: GRID_COLOR },
  };

  const renderChart = () => {
    switch (chartType) {
      case "line":
        return (
          <LineChart data={formattedData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} opacity={0.5} />
            <XAxis 
              dataKey={xKey} 
              {...commonAxisProps}
              label={xLabel ? { value: xLabel, position: "bottom", fill: TEXT_COLOR, fontSize: 11 } : undefined}
            />
            <YAxis 
              {...commonAxisProps}
              label={yLabel ? { value: yLabel, angle: -90, position: "insideLeft", fill: TEXT_COLOR, fontSize: 11 } : undefined}
            />
            <Tooltip content={<CustomTooltip yKey={yKey} />} />
            <Line
              type="monotone"
              dataKey={yKey}
              stroke={PRIMARY_COLOR}
              strokeWidth={2}
              dot={{ fill: PRIMARY_COLOR, strokeWidth: 0, r: 3 }}
              activeDot={{ r: 5, fill: PRIMARY_COLOR }}
            />
          </LineChart>
        );

      case "bar":
        return (
          <BarChart data={formattedData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} opacity={0.5} />
            <XAxis 
              dataKey={xKey} 
              {...commonAxisProps}
              label={xLabel ? { value: xLabel, position: "bottom", fill: TEXT_COLOR, fontSize: 11 } : undefined}
            />
            <YAxis 
              {...commonAxisProps}
              label={yLabel ? { value: yLabel, angle: -90, position: "insideLeft", fill: TEXT_COLOR, fontSize: 11 } : undefined}
            />
            <Tooltip content={<CustomTooltip yKey={yKey} />} />
            <Bar dataKey={yKey} fill={PRIMARY_COLOR} radius={[4, 4, 0, 0]} />
          </BarChart>
        );

      case "area":
        return (
          <AreaChart data={formattedData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <defs>
              <linearGradient id="colorGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={PRIMARY_COLOR} stopOpacity={0.3} />
                <stop offset="95%" stopColor={PRIMARY_COLOR} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} opacity={0.5} />
            <XAxis 
              dataKey={xKey} 
              {...commonAxisProps}
              label={xLabel ? { value: xLabel, position: "bottom", fill: TEXT_COLOR, fontSize: 11 } : undefined}
            />
            <YAxis 
              {...commonAxisProps}
              label={yLabel ? { value: yLabel, angle: -90, position: "insideLeft", fill: TEXT_COLOR, fontSize: 11 } : undefined}
            />
            <Tooltip content={<CustomTooltip yKey={yKey} />} />
            <Area
              type="monotone"
              dataKey={yKey}
              stroke={PRIMARY_COLOR}
              strokeWidth={2}
              fill="url(#colorGradient)"
            />
          </AreaChart>
        );

      case "pie":
        return (
          <PieChart margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
            <Pie
              data={formattedData}
              dataKey={yKey}
              nameKey={xKey}
              cx="50%"
              cy="50%"
              outerRadius={80}
              label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
              labelLine={{ stroke: TEXT_COLOR }}
            >
              {formattedData.map((_, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip yKey={yKey} />} />
            <Legend
              wrapperStyle={{ fontSize: 11, color: TEXT_COLOR }}
              formatter={(value) => <span style={{ color: TEXT_COLOR }}>{value}</span>}
            />
          </PieChart>
        );

      default:
        return <div className="text-muted-foreground">Unsupported chart type: {chartType}</div>;
    }
  };

  return (
    <div className={cn("my-4 rounded-lg border border-border bg-card/50 p-4", className)}>
      <h3 className="mb-3 text-sm font-medium text-foreground">{title}</h3>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {renderChart()}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/**
 * Parse a :::chart block and extract the config
 */
export function parseChartBlock(content: string): ChartConfig | null {
  const match = content.match(/:::chart\n([\s\S]*?)\n:::/);
  if (!match) return null;

  try {
    const config = JSON.parse(match[1]);
    if (
      config.chartType &&
      config.title &&
      Array.isArray(config.data) &&
      config.xKey &&
      config.yKey
    ) {
      return config as ChartConfig;
    }
  } catch {
    // Invalid JSON
  }

  return null;
}

/**
 * Check if content contains a chart block
 */
export function hasChartBlock(content: string): boolean {
  return content.includes(":::chart\n");
}

