"use client";

import { useState, useEffect, useMemo } from "react";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

interface OpenGraphData {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  favicon?: string;
}

// Cache for OpenGraph data to prevent refetching
const ogCache = new Map<string, OpenGraphData | null>();

// URL detection regex - matches URLs in text
const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;

// Extract URLs from text
export function extractUrls(text: string): string[] {
  const matches = text.match(URL_REGEX);
  if (!matches) return [];
  
  // Clean up URLs (remove trailing punctuation that might have been captured)
  return matches.map(url => {
    // Remove trailing punctuation that's likely not part of the URL
    return url.replace(/[.,;:!?)]+$/, '');
  });
}

// Check if a message is just a URL (or URL with minimal text)
export function isUrlOnlyMessage(text: string): boolean {
  const trimmed = text.trim();
  const urls = extractUrls(trimmed);
  
  if (urls.length === 0) return false;
  
  // Check if removing the URL leaves very little text
  let remaining = trimmed;
  for (const url of urls) {
    remaining = remaining.replace(url, '');
  }
  
  // If remaining text is just whitespace or very short, treat as URL-only
  return remaining.trim().length < 10;
}

// Hook to fetch OpenGraph data
function useOpenGraph(url: string | null): { data: OpenGraphData | null; loading: boolean } {
  const [data, setData] = useState<OpenGraphData | null>(url ? ogCache.get(url) || null : null);
  const [loading, setLoading] = useState(url ? !ogCache.has(url) : false);

  useEffect(() => {
    if (!url) {
      setData(null);
      setLoading(false);
      return;
    }

    // Check cache first
    if (ogCache.has(url)) {
      setData(ogCache.get(url) || null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const fetchData = async () => {
      try {
        const response = await fetch(`/api/opengraph?url=${encodeURIComponent(url)}`);
        if (!response.ok) throw new Error("Failed to fetch");
        
        const ogData: OpenGraphData = await response.json();
        ogCache.set(url, ogData);
        
        if (!cancelled) {
          setData(ogData);
          setLoading(false);
        }
      } catch (error) {
        console.error("Failed to fetch OpenGraph data:", error);
        ogCache.set(url, null);
        if (!cancelled) {
          setData(null);
          setLoading(false);
        }
      }
    };

    fetchData();

    return () => {
      cancelled = true;
    };
  }, [url]);

  return { data, loading };
}

// Get display domain from URL
function getDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// Link Preview component - iMessage style
export function LinkPreview({ 
  url, 
  isFromMe = false,
  className,
}: { 
  url: string; 
  isFromMe?: boolean;
  className?: string;
}) {
  const { data, loading } = useOpenGraph(url);
  const domain = useMemo(() => getDomain(url), [url]);

  if (loading) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "block overflow-hidden rounded-xl mt-1",
          "animate-pulse",
          isFromMe ? "bg-blue-400/30" : "bg-gray-200 dark:bg-gray-700/50",
          className
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-[140px] bg-current opacity-10" />
        <div className="p-3 space-y-2">
          <div className="h-4 bg-current opacity-10 rounded w-3/4" />
          <div className="h-3 bg-current opacity-10 rounded w-1/2" />
        </div>
      </a>
    );
  }

  // If no data or error, show compact link
  if (!data || (!data.title && !data.image)) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "flex items-center gap-2 px-3 py-2 mt-1 rounded-xl transition-opacity hover:opacity-80",
          isFromMe 
            ? "bg-blue-400/30 text-white" 
            : "bg-gray-200 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300",
          className
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <ExternalLink className="h-4 w-4 shrink-0 opacity-60" />
        <span className="text-sm truncate">{domain}</span>
      </a>
    );
  }

  // Rich preview - iMessage style
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "block overflow-hidden rounded-xl mt-1 transition-opacity hover:opacity-90",
        isFromMe 
          ? "bg-blue-400/20" 
          : "bg-gray-100 dark:bg-gray-800/80",
        className
      )}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Image */}
      {data.image && (
        <div className="relative w-full h-[140px] overflow-hidden bg-gray-200 dark:bg-gray-700">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={data.image}
            alt={data.title || "Link preview"}
            className="w-full h-full object-cover"
            onError={(e) => {
              // Hide broken images
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        </div>
      )}
      
      {/* Content */}
      <div className={cn(
        "p-3",
        isFromMe ? "text-white" : "text-gray-900 dark:text-gray-100"
      )}>
        {/* Site info */}
        <div className="flex items-center gap-2 mb-1">
          {data.favicon && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.favicon}
              alt=""
              className="h-4 w-4 rounded-sm"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          )}
          <span className={cn(
            "text-xs uppercase tracking-wide",
            isFromMe ? "text-blue-100" : "text-gray-500 dark:text-gray-400"
          )}>
            {data.siteName || domain}
          </span>
        </div>
        
        {/* Title */}
        {data.title && (
          <h4 className="font-semibold text-sm leading-snug line-clamp-2">
            {data.title}
          </h4>
        )}
        
        {/* Description */}
        {data.description && (
          <p className={cn(
            "text-xs mt-1 line-clamp-2 leading-relaxed",
            isFromMe ? "text-blue-100" : "text-gray-600 dark:text-gray-400"
          )}>
            {data.description}
          </p>
        )}
      </div>
    </a>
  );
}

// Component that renders message text with embedded link preview
export function MessageWithLinkPreview({
  text,
  isFromMe = false,
  renderText,
  className,
}: {
  text: string;
  isFromMe?: boolean;
  renderText?: (text: string) => React.ReactNode;
  className?: string;
}) {
  const urls = useMemo(() => extractUrls(text), [text]);
  const primaryUrl = urls[0]; // Show preview for first URL only
  const isUrlOnly = useMemo(() => isUrlOnlyMessage(text), [text]);

  // If it's a URL-only message, show just the preview (no text bubble needed)
  if (isUrlOnly && primaryUrl) {
    return (
      <LinkPreview 
        url={primaryUrl} 
        isFromMe={isFromMe}
        className={className}
      />
    );
  }

  // Otherwise, show the text and a preview below
  return (
    <div className={className}>
      {/* Text content */}
      <div>
        {renderText ? renderText(text) : text}
      </div>
      
      {/* Link preview for first URL */}
      {primaryUrl && (
        <LinkPreview 
          url={primaryUrl} 
          isFromMe={isFromMe}
        />
      )}
    </div>
  );
}

