import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APIError } from 'better-auth/api';
import { ConvexLogger } from '@confect/server';
import { ConvexError } from 'convex/values';
import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Schema from 'effect/Schema';
import { AdminRefusal, AdminRefusalCodec } from '../errorCodecs';
import { adminAuthApi, normalizeAdminAuthError, type AdminAuthOperation } from './adminAuthErrors';

const runAdminAuthApi = async (operation: AdminAuthOperation, call: () => Promise<unknown>) => {
	const exit = await Effect.runPromiseExit(
		adminAuthApi(operation, call).pipe(Effect.provide(ConvexLogger.layer))
	);
	if (Exit.isSuccess(exit)) return;
	const error = Cause.squash(exit.cause);
	throw error instanceof AdminRefusal
		? new ConvexError(Schema.encodeSync(AdminRefusalCodec)(error))
		: error;
};

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

	it('keeps the raw provider text out of the thrown data and the log', async () => {
		const error = new APIError('FORBIDDEN', {
			code: 'YOU_ARE_NOT_ALLOWED_TO_BAN_USERS',
			message: 'raw provider text that must stay internal'
		});

		await expect(
			runAdminAuthApi('ban_user', async () => Promise.reject(error))
		).rejects.toMatchObject({
			data: { code: 'ADMIN_ACTION_NOT_ALLOWED' }
		});
		expect(errorSpy).toHaveBeenCalledWith({
			code: 'admin_auth_failed',
			operation: 'ban_user',
			reason: 'ADMIN_ACTION_NOT_ALLOWED'
		});
		expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('raw provider text');

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
		expect(errorSpy).toHaveBeenCalledWith({
			code: 'admin_auth_failed',
			operation: 'revoke_user_sessions',
			reason: 'unexpected'
		});
	});
});
