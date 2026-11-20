import { describe, expect, it } from 'vitest';
import {
	draftApprovalDigest,
	renderDraftTemplate,
	validateDraftEnvelope,
	validateDraftTemplates
} from './founderIncidentDraftContent';

const template = { locale: 'en', subject: 'Hello {{userFirstName}}', text: 'From {{founderName}}' };

describe('founder incident draft content', () => {
	it.each(
		[
			[],
			[template, template],
			[{ ...template, locale: 'xx' }],
			[{ ...template, subject: ' ' }],
			[{ ...template, subject: 'x'.repeat(201) }],
			[{ ...template, text: ' ' }],
			[{ ...template, text: 'x'.repeat(20_001) }],
			[{ ...template, subject: 'Subject\nBcc: other@example.com' }],
			[{ ...template, subject: '\rSubject' }],
			[{ ...template, text: '{{founderTitle}}' }],
			[{ ...template, text: '{{ userFirstName }}' }],
			[{ ...template, text: '{{founderName}' }],
			[{ ...template, text: '{{{founderName}}}' }]
		].map((templates) => ({ templates }))
	)('rejects invalid template sets (%#)', ({ templates }) => {
		expect(() => validateDraftTemplates(templates)).toThrow();
	});

	it('accepts bounded plain text and inserts values literally without recursive expansion', () => {
		expect(
			validateDraftTemplates([{ locale: 'en', subject: 'x'.repeat(200), text: 'x'.repeat(20_000) }])
		).toHaveLength(1);
		expect(
			renderDraftTemplate([template], {
				locale: 'en',
				recipientName: ' $& Surname ',
				senderName: '{{userFirstName}}'
			})
		).toEqual({ subject: 'Hello $&', text: 'From {{userFirstName}}' });
	});

	it('rejects header line breaks introduced by a placeholder before trimming', () => {
		expect(() =>
			renderDraftTemplate([{ ...template, subject: '{{founderName}}' }], {
				locale: 'en',
				senderName: 'Ada\n'
			})
		).toThrow('rendered subject');
	});

	it('uses an empty first name when absent', () => {
		expect(renderDraftTemplate([template], { locale: 'en', senderName: 'Ada' }).subject).toBe(
			'Hello '
		);
	});

	const snapshot = {
		incident: 'incident',
		revision: 1,
		userId: 'user_1',
		locale: 'en',
		envelope: {
			from: 'Ada <founder@example.com>',
			to: 'recipient@example.com',
			replyTo: ['ada@example.com'],
			headers: [{ name: 'X-Email-Category', value: 'incident' }],
			subject: 'Restored',
			text: 'Hello'
		}
	};

	it('binds every approved snapshot field, including revision and headers', () => {
		const digest = draftApprovalDigest(snapshot);
		const changed = [
			{ ...snapshot, incident: 'other' },
			{ ...snapshot, revision: 2 },
			{ ...snapshot, userId: 'user_2' },
			{ ...snapshot, locale: 'de' },
			...Object.keys(snapshot.envelope).map((field) => ({
				...snapshot,
				envelope: {
					...snapshot.envelope,
					...(field === 'replyTo'
						? { replyTo: [] }
						: field === 'headers'
							? { headers: [] }
							: { [field]: 'changed' })
				}
			}))
		];
		for (const value of changed) expect(draftApprovalDigest(value)).not.toBe(digest);
		expect(
			draftApprovalDigest({
				...snapshot,
				envelope: {
					text: 'Hello',
					subject: 'Restored',
					headers: snapshot.envelope.headers,
					replyTo: snapshot.envelope.replyTo,
					to: snapshot.envelope.to,
					from: snapshot.envelope.from
				}
			})
		).toBe(digest);
	});

	it.each(['from', 'to', 'subject'] as const)('rejects line breaks in the final %s', (field) => {
		expect(() =>
			validateDraftEnvelope({ ...snapshot.envelope, [field]: 'Line\r\nInjection' })
		).toThrow('envelope');
	});

	it('rejects injected reply-to and oversized rendered content', () => {
		expect(() =>
			validateDraftEnvelope({
				...snapshot.envelope,
				replyTo: ['reply@example.com\nBcc: other@example.com']
			})
		).toThrow('envelope');
		expect(() => validateDraftEnvelope({ ...snapshot.envelope, text: 'x'.repeat(20_001) })).toThrow(
			'envelope'
		);
	});
});
