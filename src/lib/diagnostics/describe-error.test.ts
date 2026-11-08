import { describe, expect, it } from 'vitest';
import { describeError, encodeRecord, recordLines } from './describe-error';

const GRANT = 'b7'.repeat(32);

describe('describeError', () => {
	it('keeps name, message, stack and causes with credentials redacted', () => {
		const error = new TypeError(`refused ${GRANT} for "Wie hoch sind die Kosten?"`, {
			cause: new Error('socket closed', { cause: { code: 'ECONNRESET' } })
		});

		const described = describeError(error);

		expect(described).toMatchObject({
			name: 'TypeError',
			message: 'refused [Filtered] for "Wie hoch sind die Kosten?"',
			cause: {
				name: 'Error',
				message: 'socket closed',
				cause: { message: '{"code":"ECONNRESET"}' }
			}
		});
		expect(described.stack).toContain('describe-error.test.ts');
		expect(JSON.stringify(described)).not.toContain(GRANT);
	});

	it('follows a cause chain three levels deep', () => {
		let error = new Error('level 5');
		for (let level = 4; level >= 0; level -= 1)
			error = new Error(`level ${level}`, { cause: error });

		let depth = 0;
		for (let cause = describeError(error).cause; cause; cause = cause.cause) depth += 1;
		expect(depth).toBe(3);
	});

	it('describes thrown values that are not errors, and errors whose getters throw', () => {
		const hostile = new Error('kept');
		Object.defineProperty(hostile, 'stack', {
			get() {
				throw new Error('stack getter');
			}
		});

		expect(describeError('plain text')).toEqual({ name: 'string', message: 'plain text' });
		expect(describeError(null)).toEqual({ name: 'null', message: 'null' });
		expect(describeError({ code: 'x', token: 'secret-value' })).toEqual({
			name: 'Object',
			message: '{"code":"x","token":"[Filtered]"}'
		});
		expect(describeError(hostile)).toEqual({ name: 'Error', message: 'kept' });
	});
});

describe('encodeRecord', () => {
	const ids = { event: 'voice.tool_dispatch_failed', chatId: 'chat_1', voiceSessionId: 'voice_1' };

	it('keeps a small record in one part', () => {
		const parts = encodeRecord({ ...ids, diagnosticId: 'd1', detail: 'short' }, 8 * 1024);

		expect(parts).toHaveLength(1);
		expect(parts[0]).toMatchObject({ ...ids, diagnosticId: 'd1', part: 1, of: 1 });
		expect(JSON.parse(parts[0]!.chunk)).toEqual({ ...ids, diagnosticId: 'd1', detail: 'short' });
	});

	it('splits any structure into bounded parts that join back to the record', () => {
		const record = {
			...ids,
			// Escapes, multi-byte text and a surrogate pair at every offset.
			rows: Array.from({ length: 600 }, (_, index) => ({ index, text: `"Größe" \n 😀 ${index}` }))
		};
		const maxBytes = 1024;

		const parts = encodeRecord(record, maxBytes);

		expect(parts.length).toBeGreaterThan(5);
		const diagnosticId = parts[0]!.diagnosticId;
		for (const [index, part] of parts.entries()) {
			expect(part).toMatchObject({ ...ids, diagnosticId, part: index + 1, of: parts.length });
			expect(new TextEncoder().encode(JSON.stringify(part.chunk)).length).toBeLessThanOrEqual(
				maxBytes + 2
			);
		}
		expect(JSON.parse(parts.map((part) => part.chunk).join(''))).toEqual({
			...record,
			diagnosticId
		});
	});

	it('never throws on values JSON cannot hold', () => {
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		const throwing = {
			get value() {
				throw new Error('getter');
			}
		};

		expect(JSON.parse(encodeRecord({ cyclic, big: 10n }, 1024)[0]!.chunk)).toMatchObject({
			cyclic: { self: '[circular]' },
			big: '10'
		});
		expect(
			JSON.parse(encodeRecord({ ...ids, diagnosticId: 'd2', throwing }, 1024)[0]!.chunk)
		).toEqual({ ...ids, diagnosticId: 'd2', unserializable: '[unserializable]' });
	});

	it('writes one line per part, each a JSON object', () => {
		const lines = recordLines({ ...ids, text: 'x'.repeat(5_000) }, 1024);

		expect(lines.length).toBeGreaterThan(1);
		for (const line of lines) expect(JSON.parse(line)).toMatchObject(ids);
	});
});
