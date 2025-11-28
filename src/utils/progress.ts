/**
 * Progress tracking and logging utilities
 */

type LogLevel = 'info' | 'warn' | 'error' | 'success';

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
};

/**
 * Log a message with a component prefix
 */
export function log(component: string, message: string, level: LogLevel = 'info'): void {
  const timestamp = new Date().toLocaleTimeString();
  let color = COLORS.cyan;
  let icon = '';
  
  switch (level) {
    case 'success':
      color = COLORS.green;
      icon = '✓ ';
      break;
    case 'warn':
      color = COLORS.yellow;
      icon = '⚠ ';
      break;
    case 'error':
      color = COLORS.red;
      icon = '✗ ';
      break;
  }
  
  console.log(`${COLORS.dim}[${timestamp}]${COLORS.reset} ${color}[${component}]${COLORS.reset} ${icon}${message}`);
}

/**
 * Progress bar for long-running operations
 */
export class ProgressBar {
  private total: number;
  private current: number;
  private label: string;
  private startTime: number;
  private lastUpdate: number;
  
  constructor(label: string, total: number) {
    this.label = label;
    this.total = total;
    this.current = 0;
    this.startTime = Date.now();
    this.lastUpdate = 0;
  }
  
  update(current: number): void {
    this.current = current;
    const now = Date.now();
    
    // Only update every 100ms to avoid console spam
    if (now - this.lastUpdate < 100 && current < this.total) return;
    this.lastUpdate = now;
    
    const percent = Math.round((current / this.total) * 100);
    const filled = Math.round(percent / 5);
    const empty = 20 - filled;
    const bar = '='.repeat(filled) + (filled < 20 ? '>' : '') + ' '.repeat(Math.max(0, empty - 1));
    
    const elapsed = (now - this.startTime) / 1000;
    const rate = current / elapsed;
    const eta = rate > 0 ? Math.round((this.total - current) / rate) : 0;
    
    process.stdout.write(`\r${COLORS.cyan}[${this.label}]${COLORS.reset} [${bar}] ${percent}% (${current}/${this.total}) ETA: ${eta}s    `);
    
    if (current >= this.total) {
      console.log(''); // New line when complete
    }
  }
  
  complete(): void {
    this.update(this.total);
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
    log(this.label, `Complete! Processed ${this.total} items in ${elapsed}s`, 'success');
  }
}

/**
 * Format a number with commas for readability
 */
export function formatNumber(n: number): string {
  return n.toLocaleString();
}

