import { describe, expect, it, vi } from 'vitest';

vi.mock('$app/state', () => ({ page: { params: { lang: 'en' }, data: { lang: 'en' } } }));

import { getAppSidebarConfig } from './app-sidebar-config';

function aiChatItem(search: string, warmThreadId: string | null) {
	const config = getAppSidebarConfig(
		{ pathname: '/en/app/ai-chat', search, lang: 'en' },
		'user',
		[],
		warmThreadId
	);
	return config.navItems.find((item) => item.translationKey === 'app.sidebar.ai_chat')!;
}

// The layout prewarms an empty thread, so the AI Chat entry opens it directly
// instead of creating a thread on arrival.
describe('AI Chat sidebar entry', () => {
	it('opens the prewarmed thread', () => {
		expect(aiChatItem('', 'warm-1').url).toBe('/en/app/ai-chat?thread=warm-1');
	});

	it('opens a new chat while no thread is prewarmed', () => {
		expect(aiChatItem('', null).url).toBe('/en/app/ai-chat');
	});

	it('disables navigation only while the prewarmed thread is open', () => {
		expect(aiChatItem('?thread=warm-1', 'warm-1').disableNav).toBe(true);
		expect(aiChatItem('?thread=other', 'warm-1').disableNav).toBe(false);
	});
});
