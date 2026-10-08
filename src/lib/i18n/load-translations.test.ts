import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Tolgee } from '@tolgee/svelte';
import { FormatIcu } from '@tolgee/format-icu';
import { DEFAULT_LANGUAGE } from './languages';
import { FALLBACK_TRANSLATIONS } from './browser-translations.generated';
import type * as TranslationLoader from './load-translations';

vi.mock('$app/env', () => ({ browser: true }));

let loadTranslations: typeof TranslationLoader.loadTranslations;
let preloadTranslations: typeof TranslationLoader.preloadTranslations;
let routeLanguage: typeof TranslationLoader.routeLanguage;
const fetchCatalog = vi.fn(async (url: string) => {
	const filename = path.resolve(`.${url}`);
	return new Response(await readFile(filename, 'utf8'));
});

beforeEach(async () => {
	vi.resetModules();
	({ loadTranslations, preloadTranslations, routeLanguage } = await import('./load-translations'));
	fetchCatalog.mockClear();
	vi.stubGlobal('fetch', fetchCatalog);
});

afterEach(() => vi.unstubAllGlobals());

describe('route translation catalogs', () => {
	it('resolves localized error URLs when SvelteKit supplies no route params', () => {
		expect(routeLanguage(undefined, '/de/missing')).toBe('de');
		expect(routeLanguage(undefined, '/fr/missing')).toBe('fr');
		expect(routeLanguage(undefined, '/missing')).toBe('en');
		expect(routeLanguage('es', '/es')).toBe('es');
	});

	it('deduplicates intent and navigation without fetching another language', async () => {
		await Promise.all([
			preloadTranslations('de'),
			preloadTranslations('de'),
			loadTranslations('de')
		]);
		expect(fetchCatalog).toHaveBeenCalledTimes(1);
		expect(fetchCatalog.mock.calls[0]![0]).toContain('/de.');
		await loadTranslations('de');
		expect(fetchCatalog).toHaveBeenCalledTimes(1);
	});

	it('ignores failed speculative fetches and retries them on selection', async () => {
		fetchCatalog.mockResolvedValueOnce(new Response('Unavailable', { status: 503 }));
		await expect(preloadTranslations('fr')).resolves.toBeUndefined();
		const catalogs = await loadTranslations('fr');
		const tolgee = Tolgee().init({ language: 'fr', fallbackLanguage: 'en', staticData: catalogs });
		expect(tolgee.t('aria.change_language')).toBe('Changer la langue');
		expect(fetchCatalog).toHaveBeenCalledTimes(2);
	});
	it.each([
		['en', 'Change language'],
		['de', 'Sprache ändern'],
		['es', 'Cambiar idioma'],
		['fr', 'Changer la langue']
	])('can server-render %s immediately with only its fallback', async (language, label) => {
		const staticData = await loadTranslations(language);
		const tolgee = Tolgee().use(FormatIcu()).init({
			language,
			fallbackLanguage: DEFAULT_LANGUAGE,
			staticData
		});
		expect(tolgee.isLoaded()).toBe(true);
		expect(tolgee.t('aria.change_language')).toBe(label);
		expect(Object.keys(staticData!)).toEqual([...new Set([DEFAULT_LANGUAGE, language])]);
	});

	it('keeps English available for an untranslated key and root error pages', async () => {
		const catalogs = await loadTranslations('de');
		const tolgee = Tolgee().init({
			language: 'de',
			fallbackLanguage: DEFAULT_LANGUAGE,
			staticData: { ...catalogs, de: {} }
		});
		expect(tolgee.t('aria.change_language')).toBe('Change language');
		const errorPage = Tolgee().init({
			language: DEFAULT_LANGUAGE,
			staticData: FALLBACK_TRANSLATIONS
		});
		expect(errorPage.isLoaded()).toBe(true);
		expect(errorPage.t('aria.change_language')).toBe('Change language');
	});

	it('seeds navigation catalogs before changing language without sharing language state', async () => {
		const english = await loadTranslations('en');
		const first = Tolgee().init({ language: 'en', fallbackLanguage: 'en', staticData: english });
		const second = Tolgee().init({ language: 'en', fallbackLanguage: 'en', staticData: english });
		await first.run();
		try {
			first.addStaticData(await loadTranslations('de'));
			await first.changeLanguage('de');
			expect(first.isLoaded()).toBe(true);
			expect(first.t('aria.change_language')).toBe('Sprache ändern');
			first.addStaticData(await loadTranslations('fr'));
			await Promise.all([first.changeLanguage('en'), first.changeLanguage('fr')]);
			expect(first.t('aria.change_language')).toBe('Changer la langue');
			expect(second.t('aria.change_language')).toBe('Change language');
		} finally {
			first.stop();
		}
	});
});
