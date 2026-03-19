import { test as base, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

type AxeFixture = {
	makeAxeBuilder: () => AxeBuilder;
};

export const test = base.extend<AxeFixture>({
	makeAxeBuilder: async ({ page }, use) => {
		const makeAxeBuilder = () =>
			new AxeBuilder({ page })
				.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
				// Light-theme contrast exceptions (design-system elements)
				.exclude('[data-slot="kbd"]') // Keyboard shortcut badges (⌘K)
				.exclude('.ai-pill-bg') // AI chatbar gradient overlay
				.exclude('[data-slot="textarea"]'); // AI chatbar placeholder
		await use(makeAxeBuilder);
	}
});

export { expect };
