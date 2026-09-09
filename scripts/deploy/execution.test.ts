// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestJson } from './execution';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('deployment management HTTP cancellation', () => {
	it('does not start a request after the parent aborts', async () => {
		const fetcher = vi.fn();
		vi.stubGlobal('fetch', fetcher);
		const controller = new AbortController();
		controller.abort();
		await expect(requestJson('https://example.test', {}, controller)).rejects.toMatchObject({
			code: 'aborted'
		});
		expect(fetcher).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});
	for (const phase of ['fetch', 'body'] as const) {
		for (const stop of ['aborted', 'timed_out'] as const) {
			it(`${stop} while awaiting ${phase} settles without leaking the cause`, async () => {
				const controller = new AbortController();
				const remove = vi.spyOn(controller.signal, 'removeEventListener');
				let started!: () => void;
				const ready = new Promise<void>((resolve) => {
					started = resolve;
				});
				let childSignal: AbortSignal | undefined;
				vi.stubGlobal(
					'fetch',
					vi.fn(async (_url: string, init: RequestInit) => {
						childSignal = init.signal ?? undefined;
						const pending = () =>
							new Promise<never>((_resolve, reject) => {
								childSignal?.addEventListener(
									'abort',
									() => reject(new Error('secret network cause')),
									{ once: true }
								);
								started();
							});
						if (phase === 'fetch') return pending();
						return { ok: true, json: pending };
					})
				);
				const work = requestJson(
					'https://example.test',
					{},
					{ signal: controller.signal, timeoutMs: 20 }
				);
				const assertion = expect(work).rejects.toMatchObject({ code: stop });
				await ready;
				if (stop === 'aborted') controller.abort();
				else await vi.advanceTimersByTimeAsync(20);
				await assertion;
				expect(childSignal?.aborted).toBe(true);
				expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
				expect(vi.getTimerCount()).toBe(0);
				await expect(work).rejects.not.toThrow('secret');
			});
		}
	}
	it('cleans HTTP error bodies, listeners and timers without leaking network causes', async () => {
		const controller = new AbortController();
		const remove = vi.spyOn(controller.signal, 'removeEventListener');
		const cancel = vi.fn(async () => {});
		vi.stubGlobal(
			'fetch',
			vi
				.fn()
				.mockResolvedValueOnce({ ok: true, json: async () => ({ value: 1 }) })
				.mockRejectedValueOnce(new Error('Bearer fixture-secret'))
				.mockResolvedValueOnce({ ok: false, status: 403, body: { cancel } })
		);
		await expect(requestJson('https://example.test', {}, controller)).resolves.toEqual({
			value: 1
		});
		await expect(requestJson('https://example.test', {}, controller)).rejects.toMatchObject({
			code: 'request_failed',
			message: 'Management request failed.'
		});
		await expect(requestJson('https://example.test', {}, controller)).rejects.toMatchObject({
			code: 'request_failed',
			message: 'Management request failed (HTTP 403).'
		});
		expect(cancel).toHaveBeenCalledOnce();
		expect(remove).toHaveBeenCalledTimes(3);
		expect(vi.getTimerCount()).toBe(0);
	});
});
