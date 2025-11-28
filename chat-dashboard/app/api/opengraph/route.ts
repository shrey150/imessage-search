import { NextRequest, NextResponse } from "next/server";

interface OpenGraphData {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  favicon?: string;
}

// Simple HTML tag parser to extract meta content
function extractMetaContent(html: string, property: string): string | undefined {
  // Try og: property first
  const ogMatch = html.match(
    new RegExp(`<meta[^>]*(?:property|name)=["']og:${property}["'][^>]*content=["']([^"']*)["']`, 'i')
  ) || html.match(
    new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*(?:property|name)=["']og:${property}["']`, 'i')
  );
  
  if (ogMatch) return ogMatch[1];
  
  // Fall back to twitter: property
  const twitterMatch = html.match(
    new RegExp(`<meta[^>]*(?:property|name)=["']twitter:${property}["'][^>]*content=["']([^"']*)["']`, 'i')
  ) || html.match(
    new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*(?:property|name)=["']twitter:${property}["']`, 'i')
  );
  
  if (twitterMatch) return twitterMatch[1];
  
  // For title, also check standard meta and title tag
  if (property === 'title') {
    const titleTag = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    if (titleTag) return titleTag[1].trim();
  }
  
  // For description, also check standard meta
  if (property === 'description') {
    const descMatch = html.match(
      /<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i
    ) || html.match(
      /<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i
    );
    if (descMatch) return descMatch[1];
  }
  
  return undefined;
}

// Extract favicon from HTML
function extractFavicon(html: string, baseUrl: string): string | undefined {
  // Look for apple-touch-icon first (usually higher quality)
  const appleIcon = html.match(
    /<link[^>]*rel=["']apple-touch-icon["'][^>]*href=["']([^"']*)["']/i
  ) || html.match(
    /<link[^>]*href=["']([^"']*)["'][^>]*rel=["']apple-touch-icon["']/i
  );
  
  if (appleIcon) {
    return resolveUrl(appleIcon[1], baseUrl);
  }
  
  // Look for standard favicon
  const favicon = html.match(
    /<link[^>]*rel=["'](?:shortcut )?icon["'][^>]*href=["']([^"']*)["']/i
  ) || html.match(
    /<link[^>]*href=["']([^"']*)["'][^>]*rel=["'](?:shortcut )?icon["']/i
  );
  
  if (favicon) {
    return resolveUrl(favicon[1], baseUrl);
  }
  
  // Default to /favicon.ico
  try {
    const url = new URL(baseUrl);
    return `${url.protocol}//${url.host}/favicon.ico`;
  } catch {
    return undefined;
  }
}

// Resolve relative URLs to absolute
function resolveUrl(url: string, baseUrl: string): string {
  if (!url) return url;
  
  // Already absolute
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  
  try {
    const base = new URL(baseUrl);
    
    if (url.startsWith('//')) {
      return `${base.protocol}${url}`;
    }
    
    if (url.startsWith('/')) {
      return `${base.protocol}//${base.host}${url}`;
    }
    
    // Relative URL
    const path = base.pathname.split('/').slice(0, -1).join('/');
    return `${base.protocol}//${base.host}${path}/${url}`;
  } catch {
    return url;
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const targetUrl = searchParams.get("url");

  if (!targetUrl) {
    return NextResponse.json({ error: "URL parameter required" }, { status: 400 });
  }

  try {
    // Validate URL
    const url = new URL(targetUrl);
    
    // Only allow http/https
    if (!['http:', 'https:'].includes(url.protocol)) {
      return NextResponse.json({ error: "Invalid protocol" }, { status: 400 });
    }

    // Fetch the page with timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; LinkPreviewBot/1.0)",
        "Accept": "text/html,application/xhtml+xml",
      },
      signal: controller.signal,
      redirect: "follow",
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return NextResponse.json({ error: "Failed to fetch URL" }, { status: 502 });
    }

    const contentType = response.headers.get("content-type") || "";
    
    // Only parse HTML
    if (!contentType.includes("text/html")) {
      // For non-HTML, return basic info
      const data: OpenGraphData = {
        url: targetUrl,
        title: url.hostname,
        siteName: url.hostname,
      };
      return NextResponse.json(data);
    }

    // Read only the first 50KB to get metadata
    const reader = response.body?.getReader();
    let html = "";
    let bytesRead = 0;
    const maxBytes = 50 * 1024;

    if (reader) {
      const decoder = new TextDecoder();
      while (bytesRead < maxBytes) {
        const { done, value } = await reader.read();
        if (done) break;
        html += decoder.decode(value, { stream: true });
        bytesRead += value?.length || 0;
        
        // Stop early if we've found </head>
        if (html.includes('</head>')) break;
      }
      reader.cancel();
    }

    // Extract OpenGraph data
    const ogData: OpenGraphData = {
      url: targetUrl,
      title: extractMetaContent(html, 'title'),
      description: extractMetaContent(html, 'description'),
      image: extractMetaContent(html, 'image'),
      siteName: extractMetaContent(html, 'site_name') || url.hostname,
      favicon: extractFavicon(html, targetUrl),
    };

    // Resolve relative image URLs
    if (ogData.image) {
      ogData.image = resolveUrl(ogData.image, targetUrl);
    }

    // Cache for 1 hour
    return NextResponse.json(ogData, {
      headers: {
        "Cache-Control": "public, max-age=3600, s-maxage=3600",
      },
    });
  } catch (error) {
    console.error("OpenGraph fetch error:", error);
    
    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json({ error: "Request timeout" }, { status: 504 });
    }
    
    return NextResponse.json({ error: "Failed to fetch OpenGraph data" }, { status: 500 });
  }
}

