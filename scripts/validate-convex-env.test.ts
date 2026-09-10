// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultReply, harness } from './deploy/__fixtures__/execution';
import {
	isConvex142EnvListPermissionDenied,
	main as validateConvexEnvironment
} from './validate-convex-env';
import type { CommandResult } from './process/command-runner';

beforeEach(() => {
	vi.spyOn(console, 'log').mockImplementation(() => {});
	vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
});

function failedResult(output: string): CommandResult {
	return {
		ok: false,
		kind: 'non_zero_exit',
		description: 'bunx convex env list',
		stdout: output,
		stderr: '',
		diagnostic: 'redacted',
		exitCode: 1
	};
}

describe('Convex environment validation entry', () => {
	const ansiPermissionMarker =
		String.fromCharCode(27) + '[31mdeployment:env:view' + String.fromCharCode(27) + '[0m';

	it.each(['ViewEnvironmentVariables', 'deployment:env:view', ansiPermissionMarker])(
		'recognizes the exact Convex env-list permission marker %s',
		(marker) => {
			expect(isConvex142EnvListPermissionDenied(failedResult(marker))).toBe(true);
		}
	);

	it.each(['do not have permission', 'deployment:data:view', 'ViewEnvironmentVariable'])(
		'fails closed for unrelated permission output %s',
		(marker) => {
			expect(isConvex142EnvListPermissionDenied(failedResult(marker))).toBe(false);
		}
	);

	it('accepts the intended profile without exposing provider values', async () => {
		const h = harness();
		await expect(
			validateConvexEnvironment(['--prod', '--expected-profile', 'production'], h.execution)
		).resolves.toBeUndefined();
		expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain('runtime-secret');
	});

	it('rejects mismatched and invalid expected profiles before later work', async () => {
		const mismatch = harness({}, defaultReply);
		await expect(
			validateConvexEnvironment(
				['--deployment-name', 'preview', '--expected-profile', 'production'],
				mismatch.execution
			)
		).rejects.toMatchObject({ code: 'configuration' });

		const invalid = harness();
		await expect(
			validateConvexEnvironment(['--expected-profile', 'staging'], invalid.execution)
		).rejects.toMatchObject({ code: 'configuration' });
		expect(invalid.spawn).not.toHaveBeenCalled();
	});
});
