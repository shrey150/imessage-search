/**
 * Mac Absolute Time utilities
 * 
 * iMessage stores timestamps as nanoseconds since the Mac epoch (Jan 1, 2001).
 * We convert these to Unix timestamps (seconds since Jan 1, 1970) for storage and display.
 */

// Mac epoch starts at Jan 1, 2001 00:00:00 UTC
// Unix epoch starts at Jan 1, 1970 00:00:00 UTC
// Difference is 978307200 seconds
const MAC_EPOCH_OFFSET = 978307200;
const NANOSECOND_FACTOR = 1_000_000_000;

/**
 * Convert a Mac absolute timestamp (nanoseconds since 2001) to Unix timestamp (seconds since 1970)
 */
export function macToUnix(macTimestamp: number | bigint): number {
  // Handle BigInt or number
  const ts = typeof macTimestamp === 'bigint' ? Number(macTimestamp) : macTimestamp;
  
  // Convert from nanoseconds to seconds and add Mac epoch offset
  return Math.floor(ts / NANOSECOND_FACTOR) + MAC_EPOCH_OFFSET;
}

/**
 * Convert a Unix timestamp to a Date object
 */
export function unixToDate(unixTimestamp: number): Date {
  return new Date(unixTimestamp * 1000);
}

/**
 * Convert a Mac absolute timestamp directly to a Date object
 */
export function macToDate(macTimestamp: number | bigint): Date {
  return unixToDate(macToUnix(macTimestamp));
}

/**
 * Format a Unix timestamp as a human-readable time string (HH:MM AM/PM)
 */
export function formatTime(unixTimestamp: number): string {
  const date = unixToDate(unixTimestamp);
  return date.toLocaleTimeString('en-US', { 
    hour: 'numeric', 
    minute: '2-digit',
    hour12: true 
  });
}

/**
 * Format a Unix timestamp as a full date string
 */
export function formatDate(unixTimestamp: number): string {
  const date = unixToDate(unixTimestamp);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

/**
 * Format a Unix timestamp as ISO string
 */
export function formatISO(unixTimestamp: number): string {
  return unixToDate(unixTimestamp).toISOString();
}

/**
 * Get a human-readable relative time string (e.g., "2 hours ago", "3 days ago")
 */
export function formatRelative(unixTimestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - unixTimestamp;
  
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} days ago`;
  if (diff < 2592000) return `${Math.floor(diff / 604800)} weeks ago`;
  if (diff < 31536000) return `${Math.floor(diff / 2592000)} months ago`;
  return `${Math.floor(diff / 31536000)} years ago`;
}

/**
 * Parse an ISO date string to Unix timestamp
 */
export function parseISO(isoString: string): number {
  return Math.floor(new Date(isoString).getTime() / 1000);
}

