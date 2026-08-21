import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APIError } from 'better-auth/api';
import { normalizeAdminAuthError, runAdminAuthApi } from './admin-auth-errors';

describe('Better Auth admin error normalization', () => {
	let errorSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		errorSpy.mockRestore();
	});

	it('maps known provider codes to stable application codes', () => {
		const error = new APIError('BAD_REQUEST', {
			code: 'YOU_CANNOT_BAN_YOURSELF',
			message: 'raw provider text'
		});

		expect(normalizeAdminAuthError(error)).toBe('ADMIN_CANNOT_BAN_SELF');
	});

	it('throws only safe structured data while retaining the raw cause in logs', async () => {
		const error = new APIError('FORBIDDEN', {
			code: 'YOU_ARE_NOT_ALLOWED_TO_BAN_USERS',
			message: 'raw provider text that must stay internal'
		});

		await expect(
			runAdminAuthApi('ban_user', async () => Promise.reject(error))
		).rejects.toMatchObject({
			data: { code: 'ADMIN_ACTION_NOT_ALLOWED' }
		});
		expect(errorSpy).toHaveBeenCalledWith(
			'[admin-auth:ban_user] Better Auth operation failed',
			error
		);

		try {
			await runAdminAuthApi('ban_user', async () => Promise.reject(error));
		} catch (thrown) {
			expect(JSON.stringify((thrown as { data: unknown }).data)).not.toContain('raw provider text');
		}
	});

	it('uses a stable generic code for an unknown provider failure', async () => {
		const error = new APIError('BAD_REQUEST', {
			code: 'NEW_PROVIDER_CODE',
			message: 'provider-specific detail'
		});

		await expect(
			runAdminAuthApi('unban_user', async () => Promise.reject(error))
		).rejects.toMatchObject({ data: { code: 'ADMIN_AUTH_ACTION_FAILED' } });
	});

	it('logs and rethrows unexpected defects without disguising them', async () => {
		const defect = new TypeError('broken invariant');
		let thrown: unknown;

		try {
			await runAdminAuthApi('revoke_user_sessions', async () => Promise.reject(defect));
		} catch (error) {
			thrown = error;
		}

		expect(thrown).toBe(defect);
		expect(errorSpy).toHaveBeenCalledWith(
			'[admin-auth:revoke_user_sessions] Better Auth operation failed',
			defect
		);
	});
});
