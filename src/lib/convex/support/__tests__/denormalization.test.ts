import { describe, expect, it } from 'vitest';
import { buildSupportMessageDenormalization, buildSupportSearchText } from '../denormalization';

describe('support denormalization helpers', () => {
	it('builds support search text from the available denormalized fields', () => {
		expect(
			buildSupportSearchText({
				title: 'Billing issue',
				summary: 'Unable to upgrade',
				lastMessage: 'Card declined',
				userName: 'Ada',
				userEmail: 'ada@example.com'
			})
		).toBe('billing issue | unable to upgrade | card declined | ada | ada@example.com');
	});

	it('builds message denormalization fields from the latest message summary', () => {
		const result = buildSupportMessageDenormalization({
			title: 'Support',
			summary: 'Issue summary',
			userName: 'Kai',
			userEmail: 'kai@example.com',
			latestMessage: {
				text: 'The assistant replied with a concise answer.',
				_creationTime: 1234,
				agentName: 'Kai',
				message: { role: 'assistant' }
			}
		});

		expect(result).toEqual({
			lastMessage: 'The assistant replied with a concise answer.',
			lastMessageAt: 1234,
			lastMessageRole: 'assistant',
			lastAgentName: 'Kai',
			searchText:
				'support | issue summary | the assistant replied with a concise answer. | kai | kai@example.com'
		});
	});

	it('truncates long message previews to the support search limit', () => {
		const result = buildSupportMessageDenormalization({
			latestMessage: {
				text: 'a'.repeat(600),
				_creationTime: 1234,
				message: { role: 'user' }
			}
		});

		expect(result.lastMessage).toHaveLength(500);
		expect(result.lastMessageAt).toBe(1234);
		expect(result.lastMessageRole).toBe('user');
	});
});
