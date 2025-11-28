"use client";

import { memo, useMemo } from "react";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { AnalyticsChart, type ChartConfig } from "./analytics-chart";

export type ChatMessageProps = {
  children: string;
  className?: string;
};

// Parse a :::chart block and extract the config
function parseChartBlock(block: string): { config: ChartConfig | null; error: string | null } {
  try {
    const config = JSON.parse(block);
    
    // Check for required fields
    const missing: string[] = [];
    if (!config.chartType) missing.push('chartType');
    if (!config.title) missing.push('title');
    if (!config.data) missing.push('data');
    if (!Array.isArray(config.data) && config.data) missing.push('data must be an array');
    if (!config.xKey) missing.push('xKey');
    if (!config.yKey) missing.push('yKey');
    
    if (missing.length > 0) {
      return { config: null, error: `Missing required fields: ${missing.join(', ')}` };
    }
    
    if (config.data.length === 0) {
      return { config: null, error: 'Data array is empty' };
    }
    
    return { config: config as ChartConfig, error: null };
  } catch (e) {
    return { config: null, error: `Invalid JSON: ${e instanceof Error ? e.message : 'parse error'}` };
  }
}

// Parse content and convert chunk links to clickable elements
function parseContent(content: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  
  // First, split by chart blocks
  const chartPattern = /:::chart\n([\s\S]*?)\n:::/g;
  let lastChartIndex = 0;
  let chartMatch;
  let chartKey = 0;

  while ((chartMatch = chartPattern.exec(content)) !== null) {
    // Parse content before the chart block
    if (chartMatch.index > lastChartIndex) {
      const textBefore = content.slice(lastChartIndex, chartMatch.index);
      nodes.push(...parseTextContent(textBefore, chartKey));
      chartKey += 1000;
    }

    // Parse and render the chart
    const { config: chartConfig, error: chartError } = parseChartBlock(chartMatch[1]);
    if (chartConfig) {
      nodes.push(
        <AnalyticsChart key={`chart-${chartKey++}`} config={chartConfig} />
      );
    } else {
      // If chart parsing failed, show the error
      nodes.push(
        <div key={`chart-error-${chartKey++}`} className="my-2 p-3 rounded-lg border border-destructive/50 bg-destructive/10 text-destructive">
          <p className="text-sm font-medium">Chart Error: {chartError}</p>
          <pre className="mt-2 text-xs overflow-x-auto">{chartMatch[1].substring(0, 200)}...</pre>
        </div>
      );
    }

    lastChartIndex = chartMatch.index + chartMatch[0].length;
  }

  // Parse remaining content after last chart
  if (lastChartIndex < content.length) {
    nodes.push(...parseTextContent(content.slice(lastChartIndex), chartKey));
  }

  return nodes;
}

// Parse text content (non-chart) and convert chunk links to clickable elements
function parseTextContent(content: string, keyOffset: number): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  
  // Regex to match /search?chunk=... patterns (with or without backticks)
  const linkPattern = /`?(\/search\?chunk=[a-zA-Z0-9_-]+)`?/g;
  
  let lastIndex = 0;
  let match;
  let key = keyOffset;

  while ((match = linkPattern.exec(content)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      const textBefore = content.slice(lastIndex, match.index);
      nodes.push(...parseMarkdown(textBefore, key));
      key += 100;
    }

    // Add the link
    const linkPath = match[1];
    nodes.push(
      <Link
        key={`link-${key++}`}
        href={linkPath}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors text-sm font-mono"
      >
        🔗 View message
      </Link>
    );

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < content.length) {
    nodes.push(...parseMarkdown(content.slice(lastIndex), key));
  }

  return nodes;
}

// Simple markdown parser for basic formatting
function parseMarkdown(text: string, keyOffset: number): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  
  // Split by newlines first
  const lines = text.split('\n');
  
  lines.forEach((line, lineIdx) => {
    if (lineIdx > 0) {
      nodes.push(<br key={`br-${keyOffset}-${lineIdx}`} />);
    }

    // Check for headers
    if (line.startsWith('### ')) {
      nodes.push(
        <h3 key={`h3-${keyOffset}-${lineIdx}`} className="text-lg font-semibold mt-4 mb-2">
          {parseInline(line.slice(4), `${keyOffset}-${lineIdx}`)}
        </h3>
      );
      return;
    }
    if (line.startsWith('## ')) {
      nodes.push(
        <h2 key={`h2-${keyOffset}-${lineIdx}`} className="text-xl font-semibold mt-4 mb-2">
          {parseInline(line.slice(3), `${keyOffset}-${lineIdx}`)}
        </h2>
      );
      return;
    }

    // Check for code blocks (simple detection)
    if (line.startsWith('```')) {
      nodes.push(
        <span key={`code-marker-${keyOffset}-${lineIdx}`} className="text-muted-foreground">
          {line}
        </span>
      );
      return;
    }

    // Regular text - parse inline elements
    nodes.push(
      <span key={`line-${keyOffset}-${lineIdx}`}>
        {parseInline(line, `${keyOffset}-${lineIdx}`)}
      </span>
    );
  });

  return nodes;
}

// Parse inline markdown (bold, italic, code, links, etc.)
function parseInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  
  // Pattern for markdown links, inline code, bold, italic
  // Order matters: check links first, then bold, code, italic
  const pattern = /(\[([^\]]+)\]\(([^)]+)\))|(\*\*(.+?)\*\*)|(`([^`]+)`)|(\*(.+?)\*)/g;
  
  let lastIndex = 0;
  let match;
  let idx = 0;

  while ((match = pattern.exec(text)) !== null) {
    // Add text before match
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    if (match[1]) {
      // Markdown link: [text](url)
      const linkText = match[2];
      let linkUrl = match[3];
      
      // Handle relative URLs - ensure they start with /
      if (linkUrl.startsWith('search?') || linkUrl.startsWith('/search?')) {
        if (!linkUrl.startsWith('/')) {
          linkUrl = '/' + linkUrl;
        }
        nodes.push(
          <Link
            key={`link-${keyPrefix}-${idx++}`}
            href={linkUrl}
            className="text-primary hover:underline"
          >
            {linkText}
          </Link>
        );
      } else if (linkUrl.startsWith('http')) {
        // External link
        nodes.push(
          <a
            key={`ext-link-${keyPrefix}-${idx++}`}
            href={linkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            {linkText}
          </a>
        );
      } else {
        // Other internal link
        nodes.push(
          <Link
            key={`link-${keyPrefix}-${idx++}`}
            href={linkUrl.startsWith('/') ? linkUrl : '/' + linkUrl}
            className="text-primary hover:underline"
          >
            {linkText}
          </Link>
        );
      }
    } else if (match[4]) {
      // Bold: **text**
      nodes.push(
        <strong key={`bold-${keyPrefix}-${idx++}`} className="font-semibold">
          {match[5]}
        </strong>
      );
    } else if (match[6]) {
      // Inline code: `code`
      nodes.push(
        <code key={`code-${keyPrefix}-${idx++}`} className="px-1.5 py-0.5 rounded bg-muted text-sm font-mono">
          {match[7]}
        </code>
      );
    } else if (match[8]) {
      // Italic: *text*
      nodes.push(
        <em key={`italic-${keyPrefix}-${idx++}`}>
          {match[9]}
        </em>
      );
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length > 0 ? nodes : [text];
}

export const ChatMessage = memo(
  ({ children, className }: ChatMessageProps) => {
    const content = useMemo(() => parseContent(children), [children]);

    return (
      <div
        className={cn(
          "prose prose-sm prose-invert max-w-none",
          "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
          "leading-relaxed",
          className
        )}
      >
        {content}
      </div>
    );
  },
  (prevProps, nextProps) => prevProps.children === nextProps.children
);

ChatMessage.displayName = "ChatMessage";

