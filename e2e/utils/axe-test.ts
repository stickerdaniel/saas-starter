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
				// Exclude rules with known false positives from third-party components
				.disableRules(['color-contrast', 'svg-img-alt']);
		await use(makeAxeBuilder);
	}
});

export { expect };
