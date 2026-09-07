import { eld } from 'eld/extrasmall';
import { describe, expect, it } from 'vitest';
import {
	classifyEnglish,
	finiteLanguageScores,
	normalizeTechnicalSyntax,
	splitTextWindows,
	type LanguageDetector
} from './classifier';

const foreignFixtures = {
	german: 'Das Passwort muss sofort zurückgesetzt werden.',
	french: 'Ceci est un texte français clairement rédigé.',
	spanish: 'Este texto está claramente escrito en español.',
	japanese: 'これは明確に日本語で書かれた文章です。'
} as const;

describe('English classifier', () => {
	it.each([
		['German', foreignFixtures.german, 'de'],
		['French', foreignFixtures.french, 'fr'],
		['Spanish', foreignFixtures.spanish, 'es'],
		['Japanese', foreignFixtures.japanese, 'ja']
	])('finds clear %s prose', (_label, text, language) => {
		expect(classifyEnglish(text)).toMatchObject({ outcome: 'violation', language });
	});

	it.each(['Fix API', 'Cache JWKS', 'fix(auth): Reset password'])(
		'accepts short technical English: %s',
		(text) => {
			expect(classifyEnglish(text).outcome).toBe('accepted');
		}
	);

	it('finds the required conventional-commit fixture after removing its prefix', () => {
		const germanCommitFixture = 'fix(auth): Passwort zurücksetzen';
		expect(normalizeTechnicalSyntax(germanCommitFixture)).toBe('Passwort zurücksetzen');
		expect(classifyEnglish(germanCommitFixture)).toMatchObject({
			outcome: 'violation',
			language: 'de'
		});
	});

	it('returns insufficient evidence for content too short to classify conservatively', () => {
		expect(classifyEnglish('Ship').outcome).toBe('insufficient-evidence');
	});

	it('sorts only finite detector scores', () => {
		expect(finiteLanguageScores({ en: 0.5, de: Number.NaN, fr: 0.8, es: Infinity })).toEqual([
			{ language: 'fr', score: 0.8 },
			{ language: 'en', score: 0.5 }
		]);
	});

	it('pins the installed ELD score shape for the required German fixture', () => {
		const scores = finiteLanguageScores(eld.detect('Passwort zurücksetzen').getScores());
		expect(scores[0]?.language).toBe('de');
		expect(scores[0]?.score).toBeGreaterThan(0.75);
		expect(scores[0]?.score).toBeLessThan(0.81);
		expect(scores.find((score) => score.language === 'en')?.score).toBeLessThan(0.4);
	});

	it('does not access the detector reliability helper', () => {
		const result = {
			getScores: () => ({ de: 0.9, en: 0.1 })
		};
		Object.defineProperty(result, 'isReliable', {
			get: () => {
				throw new Error('isReliable must not be accessed');
			}
		});
		const detector: LanguageDetector = { detect: () => result };
		expect(classifyEnglish(foreignFixtures.german, detector).outcome).toBe('violation');
	});

	it('finds a foreign tail after a long English prefix', () => {
		const mixed =
			'This paragraph starts with a long English explanation about authentication, account recovery, trusted metadata, and repository policy. ' +
			foreignFixtures.german;
		const outcomes = splitTextWindows(mixed).map((window) => classifyEnglish(window.text).outcome);
		expect(outcomes).toContain('accepted');
		expect(outcomes).toContain('violation');
	});
});
