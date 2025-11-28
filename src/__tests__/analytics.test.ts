/**
 * Tests for Analytics functionality
 * Tests chart parsing, aggregation result formatting, and tool output
 */

// ============================================
// Chart Config Parsing Tests
// ============================================

interface ChartConfig {
  chartType: 'line' | 'bar' | 'area' | 'pie';
  title: string;
  data: Array<Record<string, unknown>>;
  xKey: string;
  yKey: string;
  xLabel?: string;
  yLabel?: string;
}

function parseChartBlock(content: string): ChartConfig | null {
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

function hasChartBlock(content: string): boolean {
  return content.includes(':::chart\n');
}

describe('Chart Block Parsing', () => {
  describe('parseChartBlock', () => {
    it('should parse a valid line chart config', () => {
      const content = `Some text before

:::chart
{"chartType":"line","title":"Messages over time","data":[{"label":"Jan","value":10},{"label":"Feb","value":20}],"xKey":"label","yKey":"value"}
:::

Some text after`;

      const config = parseChartBlock(content);
      
      expect(config).not.toBeNull();
      expect(config?.chartType).toBe('line');
      expect(config?.title).toBe('Messages over time');
      expect(config?.data).toHaveLength(2);
      expect(config?.xKey).toBe('label');
      expect(config?.yKey).toBe('value');
    });

    it('should parse a bar chart config', () => {
      const content = `:::chart
{"chartType":"bar","title":"Top Senders","data":[{"name":"Alice","count":50},{"name":"Bob","count":30}],"xKey":"name","yKey":"count"}
:::`;

      const config = parseChartBlock(content);
      
      expect(config?.chartType).toBe('bar');
      expect(config?.title).toBe('Top Senders');
      expect(config?.data[0]).toEqual({ name: 'Alice', count: 50 });
    });

    it('should parse a pie chart config', () => {
      const content = `:::chart
{"chartType":"pie","title":"Message Distribution","data":[{"category":"Work","value":40},{"category":"Personal","value":60}],"xKey":"category","yKey":"value"}
:::`;

      const config = parseChartBlock(content);
      
      expect(config?.chartType).toBe('pie');
    });

    it('should parse an area chart config', () => {
      const content = `:::chart
{"chartType":"area","title":"Activity Trend","data":[{"date":"2024-01","messages":100}],"xKey":"date","yKey":"messages"}
:::`;

      const config = parseChartBlock(content);
      
      expect(config?.chartType).toBe('area');
    });

    it('should parse config with optional labels', () => {
      const content = `:::chart
{"chartType":"line","title":"Test","data":[{"x":1,"y":2}],"xKey":"x","yKey":"y","xLabel":"Time","yLabel":"Count"}
:::`;

      const config = parseChartBlock(content);
      
      expect(config?.xLabel).toBe('Time');
      expect(config?.yLabel).toBe('Count');
    });

    it('should return null for content without chart block', () => {
      const content = 'Just some regular text without any chart';
      
      expect(parseChartBlock(content)).toBeNull();
    });

    it('should return null for invalid JSON in chart block', () => {
      const content = `:::chart
{invalid json here}
:::`;

      expect(parseChartBlock(content)).toBeNull();
    });

    it('should return null for chart block missing required fields', () => {
      const content = `:::chart
{"chartType":"line","title":"Test"}
:::`;

      expect(parseChartBlock(content)).toBeNull();
    });

    it('should return null for chart block with non-array data', () => {
      const content = `:::chart
{"chartType":"line","title":"Test","data":"not an array","xKey":"x","yKey":"y"}
:::`;

      expect(parseChartBlock(content)).toBeNull();
    });
  });

  describe('hasChartBlock', () => {
    it('should return true when content has chart block', () => {
      const content = `Text before
:::chart
{"chartType":"line","title":"Test","data":[],"xKey":"x","yKey":"y"}
:::
Text after`;

      expect(hasChartBlock(content)).toBe(true);
    });

    it('should return false when content has no chart block', () => {
      expect(hasChartBlock('Regular text')).toBe(false);
      expect(hasChartBlock(':::other\nblock\n:::')).toBe(false);
    });
  });
});

// ============================================
// Aggregation Result Type Tests
// ============================================

interface AggregationBucket {
  key: string;
  label: string;
  doc_count: number;
}

interface AggregationResult {
  type: 'date_histogram' | 'terms';
  field?: string;
  total: number;
  buckets: AggregationBucket[];
}

interface StatsResult {
  type: 'stats';
  field: string;
  total: number;
  count: number;
  min: number;
  max: number;
  avg: number;
  sum: number;
}

describe('Aggregation Result Types', () => {
  describe('AggregationResult', () => {
    it('should represent date_histogram results correctly', () => {
      const result: AggregationResult = {
        type: 'date_histogram',
        total: 1000,
        buckets: [
          { key: '2024-01', label: 'Jan 2024', doc_count: 100 },
          { key: '2024-02', label: 'Feb 2024', doc_count: 150 },
          { key: '2024-03', label: 'Mar 2024', doc_count: 200 },
        ],
      };

      expect(result.type).toBe('date_histogram');
      expect(result.total).toBe(1000);
      expect(result.buckets).toHaveLength(3);
      expect(result.buckets[0].key).toBe('2024-01');
      expect(result.buckets[0].label).toBe('Jan 2024');
    });

    it('should represent terms results correctly', () => {
      const result: AggregationResult = {
        type: 'terms',
        field: 'sender',
        total: 500,
        buckets: [
          { key: 'Alice', label: 'Alice', doc_count: 200 },
          { key: 'Bob', label: 'Bob', doc_count: 150 },
          { key: 'Charlie', label: 'Charlie', doc_count: 100 },
        ],
      };

      expect(result.type).toBe('terms');
      expect(result.field).toBe('sender');
      expect(result.buckets[0].doc_count).toBe(200);
    });
  });

  describe('StatsResult', () => {
    it('should represent stats results correctly', () => {
      const result: StatsResult = {
        type: 'stats',
        field: 'message_count',
        total: 1000,
        count: 1000,
        min: 1,
        max: 50,
        avg: 12.5,
        sum: 12500,
      };

      expect(result.type).toBe('stats');
      expect(result.field).toBe('message_count');
      expect(result.avg).toBe(12.5);
    });
  });
});

// ============================================
// Date/Field Formatting Helper Tests
// ============================================

describe('Formatting Helpers', () => {
  describe('formatDateLabel', () => {
    const formatDateLabel = (dateStr: string, interval: string): string => {
      if (interval === 'year') {
        return dateStr;
      }
      if (interval === 'month') {
        const [year, month] = dateStr.split('-');
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return `${monthNames[parseInt(month) - 1]} ${year}`;
      }
      return dateStr;
    };

    it('should format year correctly', () => {
      expect(formatDateLabel('2024', 'year')).toBe('2024');
    });

    it('should format month correctly', () => {
      expect(formatDateLabel('2024-01', 'month')).toBe('Jan 2024');
      expect(formatDateLabel('2024-06', 'month')).toBe('Jun 2024');
      expect(formatDateLabel('2024-12', 'month')).toBe('Dec 2024');
    });

    it('should return day/week dates as-is', () => {
      expect(formatDateLabel('2024-01-15', 'day')).toBe('2024-01-15');
      expect(formatDateLabel('2024-01-15', 'week')).toBe('2024-01-15');
    });
  });

  describe('formatFieldLabel', () => {
    const formatFieldLabel = (value: string, field: string): string => {
      if (field === 'hour_of_day') {
        const hour = parseInt(value);
        if (hour === 0) return '12 AM';
        if (hour === 12) return '12 PM';
        return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
      }
      if (field === 'month') {
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return monthNames[parseInt(value) - 1] || value;
      }
      return value;
    };

    it('should format hour_of_day correctly', () => {
      expect(formatFieldLabel('0', 'hour_of_day')).toBe('12 AM');
      expect(formatFieldLabel('6', 'hour_of_day')).toBe('6 AM');
      expect(formatFieldLabel('12', 'hour_of_day')).toBe('12 PM');
      expect(formatFieldLabel('18', 'hour_of_day')).toBe('6 PM');
      expect(formatFieldLabel('23', 'hour_of_day')).toBe('11 PM');
    });

    it('should format month correctly', () => {
      expect(formatFieldLabel('1', 'month')).toBe('Jan');
      expect(formatFieldLabel('6', 'month')).toBe('Jun');
      expect(formatFieldLabel('12', 'month')).toBe('Dec');
    });

    it('should return other field values as-is', () => {
      expect(formatFieldLabel('Alice', 'sender')).toBe('Alice');
      expect(formatFieldLabel('Monday', 'day_of_week')).toBe('Monday');
    });
  });
});

// ============================================
// render_chart Tool Output Tests
// ============================================

describe('render_chart Tool Output', () => {
  function renderChart(config: {
    chartType: string;
    title: string;
    data: Array<Record<string, unknown>>;
    xKey: string;
    yKey: string;
    xLabel?: string;
    yLabel?: string;
  }): string {
    return `:::chart\n${JSON.stringify(config)}\n:::`;
  }

  it('should produce parseable output', () => {
    const output = renderChart({
      chartType: 'line',
      title: 'Test Chart',
      data: [{ x: 1, y: 10 }],
      xKey: 'x',
      yKey: 'y',
    });

    const config = parseChartBlock(output);
    
    expect(config).not.toBeNull();
    expect(config?.chartType).toBe('line');
    expect(config?.title).toBe('Test Chart');
  });

  it('should handle complex data', () => {
    const output = renderChart({
      chartType: 'bar',
      title: 'Messages by Month',
      data: [
        { key: '2024-01', label: 'Jan 2024', doc_count: 100 },
        { key: '2024-02', label: 'Feb 2024', doc_count: 150 },
        { key: '2024-03', label: 'Mar 2024', doc_count: 200 },
      ],
      xKey: 'label',
      yKey: 'doc_count',
      xLabel: 'Month',
      yLabel: 'Message Count',
    });

    const config = parseChartBlock(output);
    
    expect(config?.data).toHaveLength(3);
    expect(config?.xLabel).toBe('Month');
    expect(config?.yLabel).toBe('Message Count');
  });

  it('should preserve all chart types', () => {
    const chartTypes = ['line', 'bar', 'area', 'pie'] as const;
    
    for (const chartType of chartTypes) {
      const output = renderChart({
        chartType,
        title: `${chartType} chart`,
        data: [{ x: 1, y: 2 }],
        xKey: 'x',
        yKey: 'y',
      });

      const config = parseChartBlock(output);
      expect(config?.chartType).toBe(chartType);
    }
  });
});

// ============================================
// Analytics Query Response Tests
// ============================================

describe('Analytics Query Responses', () => {
  describe('count response', () => {
    it('should have correct structure', () => {
      const response = { type: 'count', total: 1247 };
      
      expect(response.type).toBe('count');
      expect(response.total).toBe(1247);
    });
  });

  describe('date_histogram response', () => {
    it('should convert to chart-ready format', () => {
      const response: AggregationResult = {
        type: 'date_histogram',
        total: 500,
        buckets: [
          { key: '2024-01', label: 'Jan 2024', doc_count: 100 },
          { key: '2024-02', label: 'Feb 2024', doc_count: 150 },
        ],
      };

      // Convert to chart data format
      const chartData = response.buckets.map(b => ({
        label: b.label,
        count: b.doc_count,
      }));

      expect(chartData).toEqual([
        { label: 'Jan 2024', count: 100 },
        { label: 'Feb 2024', count: 150 },
      ]);
    });
  });

  describe('terms response', () => {
    it('should convert to chart-ready format', () => {
      const response: AggregationResult = {
        type: 'terms',
        field: 'sender',
        total: 300,
        buckets: [
          { key: 'Alice', label: 'Alice', doc_count: 150 },
          { key: 'Bob', label: 'Bob', doc_count: 100 },
          { key: 'Charlie', label: 'Charlie', doc_count: 50 },
        ],
      };

      // Convert to chart data format
      const chartData = response.buckets.map(b => ({
        name: b.label,
        messages: b.doc_count,
      }));

      expect(chartData).toHaveLength(3);
      expect(chartData[0]).toEqual({ name: 'Alice', messages: 150 });
    });
  });
});

// ============================================
// Integration Tests (Simulated)
// ============================================

describe('Analytics Flow Integration', () => {
  it('should support the full analytics → chart flow', () => {
    // Simulate analytics_query response
    const analyticsResponse: AggregationResult = {
      type: 'date_histogram',
      total: 450,
      buckets: [
        { key: '2024-01', label: 'Jan 2024', doc_count: 89 },
        { key: '2024-02', label: 'Feb 2024', doc_count: 142 },
        { key: '2024-03', label: 'Mar 2024', doc_count: 219 },
      ],
    };

    // Convert to chart data
    const chartData = analyticsResponse.buckets.map(b => ({
      label: b.label,
      count: b.doc_count,
    }));

    // Simulate render_chart call
    const chartOutput = `:::chart
${JSON.stringify({
  chartType: 'line',
  title: 'Messages over time',
  data: chartData,
  xKey: 'label',
  yKey: 'count',
})}
:::`;

    // Parse and verify
    const parsedConfig = parseChartBlock(chartOutput);
    
    expect(parsedConfig).not.toBeNull();
    expect(parsedConfig?.chartType).toBe('line');
    expect(parsedConfig?.data).toHaveLength(3);
    expect(parsedConfig?.data[2]).toEqual({ label: 'Mar 2024', count: 219 });
  });

  it('should support pie chart for distribution data', () => {
    // Simulate terms aggregation response
    const analyticsResponse: AggregationResult = {
      type: 'terms',
      field: 'day_of_week',
      total: 700,
      buckets: [
        { key: 'Monday', label: 'Monday', doc_count: 150 },
        { key: 'Tuesday', label: 'Tuesday', doc_count: 120 },
        { key: 'Wednesday', label: 'Wednesday', doc_count: 100 },
        { key: 'Thursday', label: 'Thursday', doc_count: 110 },
        { key: 'Friday', label: 'Friday', doc_count: 130 },
        { key: 'Saturday', label: 'Saturday', doc_count: 50 },
        { key: 'Sunday', label: 'Sunday', doc_count: 40 },
      ],
    };

    const chartData = analyticsResponse.buckets.map(b => ({
      day: b.label,
      messages: b.doc_count,
    }));

    const chartOutput = `:::chart
${JSON.stringify({
  chartType: 'pie',
  title: 'Messages by Day of Week',
  data: chartData,
  xKey: 'day',
  yKey: 'messages',
})}
:::`;

    const parsedConfig = parseChartBlock(chartOutput);
    
    expect(parsedConfig?.chartType).toBe('pie');
    expect(parsedConfig?.data).toHaveLength(7);
  });
});

