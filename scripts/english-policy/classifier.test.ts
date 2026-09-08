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
	japanese: 'これは明確に日本語で書かれた文章です。',
	thai: 'นี่เป็นข้อความภาษาไทยที่ชัดเจน',
	korean: '한국어로 작성된 명확한 문장입니다'
} as const;

describe('English classifier', () => {
	it.each([
		['German', foreignFixtures.german, 'de'],
		['French', foreignFixtures.french, 'fr'],
		['Spanish', foreignFixtures.spanish, 'es'],
		['Japanese', foreignFixtures.japanese, 'ja'],
		['Thai', foreignFixtures.thai, 'th'],
		['Korean', foreignFixtures.korean, 'ko']
	])('finds clear %s prose', (_label, text, language) => {
		expect(classifyEnglish(text)).toMatchObject({ outcome: 'violation', language });
	});

	it.each([
		'Fix API',
		'Update API',
		'API documentation',
		'API configuration',
		'Cache JWKS',
		'fix(auth): Reset password',
		'Update docs',
		'Load data',
		'Write guide',
		'Sign in user',
		'Ship change',
		'Improve auth',
		'Handle retry',
		'invalid format'
	])('accepts or conservatively passes short English: %s', (text) => {
		expect(classifyEnglish(text).outcome).not.toBe('violation');
	});

	it.each([
		'fix: Fehler beheben',
		'docs: Anleitung schreiben',
		'test: Daten laden',
		'feat: Benutzer anmelden'
	])('finds clear short German titles: %s', (text) => {
		expect(classifyEnglish(text)).toMatchObject({ outcome: 'violation', language: 'de' });
	});

	it.each(['docs: API aktualisieren', 'API aktualisieren'])(
		'finds a clear foreign subject after removing an acronym: %s',
		(text) => {
			expect(normalizeTechnicalSyntax(text)).toBe('aktualisieren');
			expect(classifyEnglish(text)).toMatchObject({ outcome: 'violation', language: 'de' });
		}
	);

	it('pins strong ELD evidence for the single German subject', () => {
		const scores = finiteLanguageScores(eld.detect('aktualisieren').getScores());
		expect(scores[0]).toMatchObject({ language: 'de' });
		expect(scores[0]!.score).toBeGreaterThan(0.79);
		expect(scores[0]!.score).toBeLessThan(0.8);
		expect(scores.find((score) => score.language === 'en')).toBeUndefined();
	});

	it('finds the required conventional-commit fixture after removing its prefix', () => {
		const germanCommitFixture = 'fix(auth): Passwort zurücksetzen';
		expect(normalizeTechnicalSyntax(germanCommitFixture)).toBe('Passwort zurücksetzen');
		expect(classifyEnglish(germanCommitFixture)).toMatchObject({
			outcome: 'violation',
			language: 'de'
		});
	});

	it.each([
		['fix(auth): PASSWORT ZURUECKSETZEN', 'PASSWORT ZURUECKSETZEN', 'de'],
		['fix: PASSWORT1 ZURUECKSETZEN1', 'PASSWORT ZURUECKSETZEN', 'de'],
		['fix: PASSWORT_1 ZURUECKSETZEN_1', 'PASSWORT ZURUECKSETZEN', 'de'],
		['fix: PASSWORT1_ZURUECKSETZEN1', 'PASSWORT ZURUECKSETZEN', 'de'],
		[
			'ESTE TEXTO ESTA CLARAMENTE ESCRITO EN ESPANOL',
			'ESTE TEXTO ESTA CLARAMENTE ESCRITO EN ESPANOL',
			'es'
		]
	])('preserves uppercase prose for detection: %s', (text, normalized, language) => {
		expect(normalizeTechnicalSyntax(text)).toBe(normalized);
		expect(classifyEnglish(text)).toMatchObject({ outcome: 'violation', language });
	});

	it.each([
		['Fix API', 'Fix'],
		['Use HTTP2 API_V2', 'Use'],
		['Validate UTF_8 JSONC', 'Validate']
	])('removes registered acronyms and technical version tokens: %s', (text, normalized) => {
		expect(normalizeTechnicalSyntax(text)).toBe(normalized);
		expect(classifyEnglish(text).outcome).not.toBe('violation');
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

	it('keeps technical periods inside the surrounding sentence', () => {
		const releaseNote =
			'Update details at https://github.com/vitest-dev/vitest/compare/v4.0.14...v4.0.15 before reviewing version 4.0.15.';
		const windows = splitTextWindows(releaseNote);
		expect(windows[0]?.text).toBe(releaseNote);
		expect(windows.map((window) => classifyEnglish(window.text).outcome)).not.toContain(
			'violation'
		);
	});

	it('reports a sentence after a newline on its own line', () => {
		const windows = splitTextWindows(`The first sentence is English.\n${foreignFixtures.german}`);
		expect(windows).toMatchObject([
			{ text: 'The first sentence is English.', line: 1 },
			{ text: foreignFixtures.german, line: 2 }
		]);
	});

	it('finds a foreign tail after a long English prefix', () => {
		const mixed =
			'This paragraph starts with a long English explanation about authentication, account recovery, trusted metadata, and repository policy. ' +
			foreignFixtures.german;
		const outcomes = splitTextWindows(mixed).map((window) => classifyEnglish(window.text).outcome);
		expect(outcomes).toContain('accepted');
		expect(outcomes).toContain('violation');
	});

	it.each([
		'This updates authentication while das Passwort sofort zurückgesetzt werden muss.',
		'Das Passwort muss sofort zurückgesetzt werden while authentication stays available.'
	])('finds a foreign clause in a shorter mixed sentence: %s', (mixed) => {
		const outcomes = splitTextWindows(mixed).map((window) => classifyEnglish(window.text).outcome);
		expect(outcomes).toContain('violation');
	});
});
