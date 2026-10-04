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

	it('surfaces a row referencing a deleted user via its live participant', () => {
		// "ghost" is a deleted user: its id lives in the log but never appears in a
		// match set (collectMatchingUserIds only returns live users). The row still
		// surfaces because the other participant (admin1) matches.
		const withGhost: Row[] = [{ adminUserId: 'admin1', targetUserId: 'ghost', label: 'g' }];
		expect(filterAuditRowsByMatch(withGhost, new Set(['admin1']))).toHaveLength(1);
		// With only the deleted user "matched" (which never happens for a real
		// search, but guards the membership check), the row is dropped.
		expect(filterAuditRowsByMatch(withGhost, new Set(['ghost']))).toHaveLength(1);
		expect(filterAuditRowsByMatch(withGhost, new Set(['someone-else']))).toEqual([]);
	});
});
