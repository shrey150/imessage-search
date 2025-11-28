/**
 * Tests for LLM Query Parser
 * Tests the resolveTemporalFilter function which converts relative dates to absolute
 */

import { QueryParser } from '../tools/query-parser.js';

describe('QueryParser', () => {
  let parser: QueryParser;

  beforeAll(() => {
    // Create parser without API key - we're only testing resolveTemporalFilter
    parser = new QueryParser('fake-api-key');
  });

  describe('resolveTemporalFilter', () => {
    it('should return empty object for undefined temporal', () => {
      const result = parser.resolveTemporalFilter(undefined);
      expect(result).toEqual({});
    });

    it('should return empty object for empty temporal', () => {
      const result = parser.resolveTemporalFilter({});
      expect(result).toEqual({});
    });

    describe('relative dates', () => {
      it('should resolve "today" to a timestamp_gte', () => {
        const result = parser.resolveTemporalFilter({ relative: 'today' });
        
        expect(result.timestamp_gte).toBeDefined();
        expect(typeof result.timestamp_gte).toBe('string');
        // Should be an ISO date string
        expect(result.timestamp_gte).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      });

      it('should resolve "yesterday" to a date range', () => {
        const result = parser.resolveTemporalFilter({ relative: 'yesterday' });
        
        expect(result.timestamp_gte).toBeDefined();
        expect(result.timestamp_lte).toBeDefined();
        
        // Both should be ISO date strings
        expect(result.timestamp_gte).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(result.timestamp_lte).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        
        // lte should be after gte
        const gte = new Date(result.timestamp_gte!);
        const lte = new Date(result.timestamp_lte!);
        expect(lte.getTime()).toBeGreaterThan(gte.getTime());
      });

      it('should resolve "this_week" to a timestamp_gte', () => {
        const result = parser.resolveTemporalFilter({ relative: 'this_week' });
        
        expect(result.timestamp_gte).toBeDefined();
        const gte = new Date(result.timestamp_gte!);
        // Should be a Sunday (start of week)
        expect(gte.getDay()).toBe(0);
      });

      it('should resolve "last_week" to a date range', () => {
        const result = parser.resolveTemporalFilter({ relative: 'last_week' });
        
        expect(result.timestamp_gte).toBeDefined();
        expect(result.timestamp_lte).toBeDefined();
        
        // The difference should be about 7 days
        const gte = new Date(result.timestamp_gte!);
        const lte = new Date(result.timestamp_lte!);
        const diffDays = (lte.getTime() - gte.getTime()) / (1000 * 60 * 60 * 24);
        expect(diffDays).toBeCloseTo(7, 0);
      });

      it('should resolve "this_month" to first day of current month', () => {
        const result = parser.resolveTemporalFilter({ relative: 'this_month' });
        
        expect(result.timestamp_gte).toBeDefined();
        const gte = new Date(result.timestamp_gte!);
        // Should be the 1st of the month
        expect(gte.getDate()).toBe(1);
      });

      it('should resolve "last_month" to a date range', () => {
        const result = parser.resolveTemporalFilter({ relative: 'last_month' });
        
        expect(result.timestamp_gte).toBeDefined();
        expect(result.timestamp_lte).toBeDefined();
        
        const gte = new Date(result.timestamp_gte!);
        const lte = new Date(result.timestamp_lte!);
        
        // Start should be the 1st
        expect(gte.getDate()).toBe(1);
        // End should be last day of the month
        const nextDay = new Date(lte);
        nextDay.setDate(nextDay.getDate() + 1);
        expect(nextDay.getDate()).toBe(1); // Next day is 1st of next month
      });

      it('should resolve "this_year" to first day of current year', () => {
        const result = parser.resolveTemporalFilter({ relative: 'this_year' });
        
        expect(result.timestamp_gte).toBeDefined();
        const gte = new Date(result.timestamp_gte!);
        expect(gte.getMonth()).toBe(0); // January
        expect(gte.getDate()).toBe(1);
      });

      it('should resolve "last_year" to a date range for previous year', () => {
        const result = parser.resolveTemporalFilter({ relative: 'last_year' });
        
        expect(result.timestamp_gte).toBeDefined();
        expect(result.timestamp_lte).toBeDefined();
        
        const gte = new Date(result.timestamp_gte!);
        const lte = new Date(result.timestamp_lte!);
        
        // Start should be Jan 1
        expect(gte.getMonth()).toBe(0);
        expect(gte.getDate()).toBe(1);
        
        // End should be Dec 31 of same year as start
        expect(lte.getFullYear()).toBe(gte.getFullYear());
        expect(lte.getMonth()).toBe(11);
        expect(lte.getDate()).toBe(31);
      });
    });

    describe('explicit date ranges', () => {
      it('should pass through date_gte', () => {
        const result = parser.resolveTemporalFilter({ 
          date_gte: '2024-06-01' 
        });
        
        expect(result.timestamp_gte).toBe('2024-06-01');
      });

      it('should pass through date_lte', () => {
        const result = parser.resolveTemporalFilter({ 
          date_lte: '2024-12-31' 
        });
        
        expect(result.timestamp_lte).toBe('2024-12-31');
      });

      it('should handle both date_gte and date_lte', () => {
        const result = parser.resolveTemporalFilter({ 
          date_gte: '2024-01-01',
          date_lte: '2024-06-30'
        });
        
        expect(result.timestamp_gte).toBe('2024-01-01');
        expect(result.timestamp_lte).toBe('2024-06-30');
      });
    });

    describe('specific temporal fields', () => {
      it('should pass through year', () => {
        const result = parser.resolveTemporalFilter({ year: 2024 });
        expect(result.year).toBe(2024);
      });

      it('should pass through month', () => {
        const result = parser.resolveTemporalFilter({ month: 9 });
        expect(result.month).toBe(9);
      });

      it('should pass through months array', () => {
        const result = parser.resolveTemporalFilter({ months: [8, 9, 10, 11, 12] });
        expect(result.month).toEqual([8, 9, 10, 11, 12]);
      });

      it('should normalize day_of_week to lowercase', () => {
        const result = parser.resolveTemporalFilter({ day_of_week: 'FRIDAY' });
        expect(result.day_of_week).toBe('friday');
      });

      it('should pass through hour_gte', () => {
        const result = parser.resolveTemporalFilter({ hour_gte: 22 });
        expect(result.hour_of_day_gte).toBe(22);
      });

      it('should pass through hour_lte', () => {
        const result = parser.resolveTemporalFilter({ hour_lte: 6 });
        expect(result.hour_of_day_lte).toBe(6);
      });

      it('should handle late night hours (hour_gte: 22, hour_lte: 3)', () => {
        const result = parser.resolveTemporalFilter({ 
          hour_gte: 22, 
          hour_lte: 3 
        });
        expect(result.hour_of_day_gte).toBe(22);
        expect(result.hour_of_day_lte).toBe(3);
      });
    });

    describe('combined filters', () => {
      it('should handle year + month combination', () => {
        const result = parser.resolveTemporalFilter({ 
          year: 2024, 
          month: 9 
        });
        
        expect(result.year).toBe(2024);
        expect(result.month).toBe(9);
      });

      it('should handle relative date with day_of_week', () => {
        const result = parser.resolveTemporalFilter({ 
          relative: 'this_month',
          day_of_week: 'friday'
        });
        
        expect(result.timestamp_gte).toBeDefined();
        expect(result.day_of_week).toBe('friday');
      });

      it('should handle all temporal fields together', () => {
        const result = parser.resolveTemporalFilter({
          year: 2024,
          month: 6,
          day_of_week: 'monday',
          hour_gte: 9,
          hour_lte: 17,
        });
        
        expect(result.year).toBe(2024);
        expect(result.month).toBe(6);
        expect(result.day_of_week).toBe('monday');
        expect(result.hour_of_day_gte).toBe(9);
        expect(result.hour_of_day_lte).toBe(17);
      });
    });
  });
});
