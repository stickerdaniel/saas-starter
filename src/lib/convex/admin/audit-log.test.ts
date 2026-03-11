import { describe, expect, it } from 'vitest';
import {
	buildCanonicalAdminActionAuditEntry,
	createUserEmailMap,
	isCanonicalAdminActionLog,
	mergeUnifiedAdminAuditLogs
} from './audit-log';

describe('admin audit log helpers', () => {
	it('builds canonical admin action entries in the resource audit shape', () => {
		const entry = buildCanonicalAdminActionAuditEntry({
			adminUserId: 'admin_1',
			adminEmail: 'admin@example.com',
			targetUserId: 'user_1',
			action: 'ban_user',
			metadata: { reason: 'spam' },
			timestamp: 123
		});

		expect(entry).toMatchObject({
			adminUserId: 'admin_1',
			adminEmail: 'admin@example.com',
			event: 'Action',
			resourceName: 'users',
			resourceId: 'user_1',
			actionName: 'ban_user',
			changes: { reason: 'spam' },
			status: 'finished',
			timestamp: 123
		});
	});

	it('merges legacy history with canonical admin action logs and skips unrelated resource events', () => {
		const userEmails = createUserEmailMap([
			{ _id: 'admin_1', email: 'admin@example.com' },
			{ _id: 'user_1', email: 'user@example.com' }
		]);

		const legacyLogs = [
			{
				_id: 'legacy_1',
				adminUserId: 'admin_1',
				action: 'impersonate',
				targetUserId: 'user_1',
				metadata: {},
				timestamp: 100
			}
		] as any;

		const canonicalLogs = [
			{
				_id: 'canonical_1',
				adminUserId: 'admin_1',
				adminEmail: 'admin@example.com',
				event: 'Action',
				resourceName: 'users',
				resourceId: 'user_1',
				actionName: 'ban_user',
				changes: { reason: 'spam' },
				status: 'finished',
				timestamp: 200
			},
			{
				_id: 'canonical_2',
				adminUserId: 'admin_1',
				adminEmail: 'admin@example.com',
				event: 'Update',
				resourceName: 'demo-projects',
				resourceId: 'project_1',
				status: 'finished',
				timestamp: 300
			}
		] as any;

		expect(isCanonicalAdminActionLog(canonicalLogs[0])).toBe(true);
		expect(isCanonicalAdminActionLog(canonicalLogs[1])).toBe(false);

		const merged = mergeUnifiedAdminAuditLogs({
			legacyLogs,
			canonicalLogs,
			userEmails,
			limit: 10
		});

		expect(merged).toHaveLength(2);
		expect(merged[0]).toMatchObject({
			_id: 'canonical_1',
			action: 'ban_user',
			adminEmail: 'admin@example.com',
			targetEmail: 'user@example.com',
			source: 'canonical'
		});
		expect(merged[1]).toMatchObject({
			_id: 'legacy_1',
			action: 'impersonate',
			targetEmail: 'user@example.com',
			source: 'legacy'
		});
	});
});
