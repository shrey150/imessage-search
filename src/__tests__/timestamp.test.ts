/**
 * Tests for timestamp utilities
 */

import {
  macToUnix,
  unixToDate,
  macToDate,
  formatTime,
  formatDate,
  formatRelative,
  parseISO,
} from '../utils/timestamp.js';

describe('Timestamp utilities', () => {
  // Known reference: Nov 28, 2025 at ~2:20 AM UTC
  // Mac timestamp from our exploration: 785989245952588500
  const KNOWN_MAC_TS = 785989245952588500;
  // MAC_EPOCH = 978307200, so: floor(785989245952588500 / 1e9) + 978307200
  const EXPECTED_UNIX_TS = Math.floor(785989245952588500 / 1_000_000_000) + 978307200;

  describe('macToUnix', () => {
    it('should convert Mac nanosecond timestamp to Unix timestamp', () => {
      const unix = macToUnix(KNOWN_MAC_TS);
      
      // Should be within a few seconds of expected
      expect(Math.abs(unix - EXPECTED_UNIX_TS)).toBeLessThan(10);
    });

    it('should handle BigInt input', () => {
      const unix = macToUnix(BigInt(KNOWN_MAC_TS));
      
      expect(Math.abs(unix - EXPECTED_UNIX_TS)).toBeLessThan(10);
    });

    it('should return correct year for known timestamp', () => {
      const unix = macToUnix(KNOWN_MAC_TS);
      const date = new Date(unix * 1000);
      
      expect(date.getFullYear()).toBe(2025);
    });
  });

  describe('unixToDate', () => {
    it('should convert Unix timestamp to Date object', () => {
      const date = unixToDate(EXPECTED_UNIX_TS);
      
      expect(date).toBeInstanceOf(Date);
      expect(date.getUTCFullYear()).toBe(2025);
    });
  });

  describe('macToDate', () => {
    it('should convert Mac timestamp directly to Date', () => {
      const date = macToDate(KNOWN_MAC_TS);
      
      expect(date).toBeInstanceOf(Date);
      expect(date.getFullYear()).toBe(2025);
    });
  });

  describe('formatTime', () => {
    it('should format time as HH:MM AM/PM', () => {
      const formatted = formatTime(EXPECTED_UNIX_TS);
      
      // Should contain AM or PM
      expect(formatted).toMatch(/\d{1,2}:\d{2}\s*(AM|PM)/i);
    });
  });

  describe('formatDate', () => {
    it('should format date with month, day, year', () => {
      const formatted = formatDate(EXPECTED_UNIX_TS);
      
      expect(formatted).toContain('2025');
      // Month might vary by timezone, just check it's a valid format
      expect(formatted).toMatch(/\w+ \d+, \d{4}/);
    });
  });

  describe('formatRelative', () => {
    it('should return "just now" for very recent times', () => {
      const now = Math.floor(Date.now() / 1000);
      const formatted = formatRelative(now - 30);
      
      expect(formatted).toBe('just now');
    });

    it('should return minutes for times under an hour', () => {
      const now = Math.floor(Date.now() / 1000);
      const formatted = formatRelative(now - 600); // 10 minutes ago
      
      expect(formatted).toMatch(/\d+ minutes ago/);
    });

    it('should return hours for times under a day', () => {
      const now = Math.floor(Date.now() / 1000);
      const formatted = formatRelative(now - 7200); // 2 hours ago
      
      expect(formatted).toMatch(/\d+ hours ago/);
    });

    it('should return days for times under a week', () => {
      const now = Math.floor(Date.now() / 1000);
      const formatted = formatRelative(now - 172800); // 2 days ago
      
      expect(formatted).toMatch(/\d+ days ago/);
    });
  });

  describe('parseISO', () => {
    it('should parse ISO date string to Unix timestamp', () => {
      const unix = parseISO('2025-01-01T00:00:00Z');
      
      expect(unix).toBe(1735689600);
    });

    it('should handle date-only ISO strings', () => {
      const unix = parseISO('2025-01-01');
      
      // Should be close to midnight on that date (may vary by timezone)
      const date = new Date(unix * 1000);
      expect(date.getUTCFullYear()).toBe(2025);
      expect(date.getUTCMonth()).toBe(0); // January
      expect(date.getUTCDate()).toBe(1);
    });
  });
});

