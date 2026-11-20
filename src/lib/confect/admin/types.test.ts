import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseBetterAuthUsers } from './types';

describe('parseBetterAuthUsers', () => {
	let warnSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
	});

	afterEach(() => {
		warnSpy.mockRestore();
	});

	it('drops an invalid record and logs its field without the rejected value', () => {
		const users = parseBetterAuthUsers([
			{ _id: 'user-1', email: 'valid@example.com' },
			{ _id: 'user-2', email: 'other@example.com', role: 'alice@example.com' }
		]);

		expect(users.map((user) => user._id)).toEqual(['user-1']);
		expect(warnSpy).toHaveBeenCalledWith({ code: 'better_auth_user_invalid', field: 'role' });
		expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('alice@example.com');
	});
});
