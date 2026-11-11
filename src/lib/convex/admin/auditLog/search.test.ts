import { describe, expect, it } from 'vitest';
import { filterAuditRowsByMatch } from './search';

type Row = { adminUserId: string; targetUserId: string; label: string };

const rows: Row[] = [
	{ adminUserId: 'admin1', targetUserId: 'alice', label: 'a' },
	{ adminUserId: 'admin1', targetUserId: 'bob', label: 'b' },
	{ adminUserId: 'admin2', targetUserId: 'alice', label: 'c' },
	{ adminUserId: 'alice', targetUserId: 'carol', label: 'd' } // alice acting as admin
];

describe('filterAuditRowsByMatch', () => {
	it('drops every row when the match set is empty', () => {
		// A search that resolved to no users must surface no rows.
		expect(filterAuditRowsByMatch(rows, new Set())).toEqual([]);
	});

	it('keeps every row when both participants are matched', () => {
		const matched = new Set(['admin1', 'admin2', 'alice', 'bob', 'carol']);
		expect(filterAuditRowsByMatch(rows, matched)).toHaveLength(rows.length);
	});

	it('keeps a row when either the admin or the target matches', () => {
		// Matching only "alice" surfaces rows where she is the target (a, c) and
		// the row where she is the admin (d), but not the bob-only row (b).
		const result = filterAuditRowsByMatch(rows, new Set(['alice']));
		expect(result.map((row) => row.label)).toEqual(['a', 'c', 'd']);
	});
});
