import { extractReasoning } from '../../src/lib/chat/core/message-extraction.ts';
import { PDF_FIXTURE_WORD } from './fixtures.ts';
import type { CatalogInfo, MaterializedAssistant, Verdict } from './types.ts';

const REASONING_MIN = 32;
const ANSWER_MIN = 20;
const VISION_REFUSAL =
	/\b(cannot see|can't see|no image|unable to (?:view|see|read)|don't support (?:images|vision)|not able to (?:view|see))\b/i;

function reasoningText(mat: MaterializedAssistant): string {
	return mat.parts
		.filter((p) => p.type === 'reasoning')
		.map((p) =>
			typeof (p as { text?: string }).text === 'string' ? (p as { text: string }).text : ''
		)
		.join('');
}

function answerText(mat: MaterializedAssistant): string {
	const fromParts = mat.parts
		.filter((p) => p.type === 'text')
		.map((p) => (p as { text?: string }).text ?? '')
		.join('');
	return (fromParts || mat.displayText).trim();
}

export function checkCatalog(catalog: CatalogInfo | null): Verdict {
	if (!catalog) {
		return {
			capability: 'catalog',
			status: 'fail',
			notes: ['model not found in OpenRouter catalog'],
			ms: null
		};
	}
	const notes: string[] = [];
	let status: Verdict['status'] = 'pass';
	if (!catalog.hasReasoning) {
		notes.push('no reasoning param');
		status = 'fail';
	}
	if (!catalog.hasImage) {
		notes.push('no image modality');
		status = 'fail';
	}
	if (!catalog.hasTools) notes.push('no tools param');
	if (!catalog.hasFile) notes.push('no file modality');
	if (status === 'pass' && notes.length > 0) status = 'warn';
	return { capability: 'catalog', status, notes, ms: null };
}

export function checkText(mat: MaterializedAssistant, ms: number): Verdict {
	const answer = answerText(mat);
	if (answer.length < ANSWER_MIN) {
		return {
			capability: 'text',
			status: 'fail',
			notes: [`answer too short (${answer.length} chars) — possible reasoning-only stall`],
			ms
		};
	}
	return { capability: 'text', status: 'pass', notes: [], ms };
}

export function checkReasoning(mat: MaterializedAssistant, ms: number): Verdict {
	const notes: string[] = [];
	const inParts = reasoningText(mat).length;
	if (inParts < REASONING_MIN) notes.push(`reasoning parts too short (${inParts} chars)`);
	if ((mat.displayReasoning ?? '').length < REASONING_MIN) notes.push('displayReasoning too short');
	const extracted = extractReasoning(mat.parts as Parameters<typeof extractReasoning>[0]) ?? '';
	if (extracted.length < REASONING_MIN) notes.push('extractReasoning too short');
	return { capability: 'reasoning', status: notes.length === 0 ? 'pass' : 'fail', notes, ms };
}

export function checkImage(mat: MaterializedAssistant, ms: number): Verdict {
	const answer = answerText(mat);
	if (VISION_REFUSAL.test(answer)) {
		return { capability: 'image', status: 'fail', notes: ['model could not see the image'], ms };
	}
	// Fixture is a photo of a tabby cat; a model with working vision names it.
	if (!/\b(cat|kitten|feline|tabby|kitty)\b/i.test(answer)) {
		return {
			capability: 'image',
			status: 'fail',
			notes: [`expected the cat in the photo, got: ${answer.slice(0, 80)}`],
			ms
		};
	}
	return { capability: 'image', status: 'pass', notes: [], ms };
}

export function checkPdf(
	mat: MaterializedAssistant,
	ms: number,
	catalog: CatalogInfo | null
): Verdict {
	const answer = answerText(mat);
	const notes: string[] = [];
	if (catalog && !catalog.hasFile) notes.push('catalog lacks file modality');
	if (VISION_REFUSAL.test(answer)) {
		return {
			capability: 'pdf',
			status: 'fail',
			notes: [...notes, 'model could not read the PDF'],
			ms
		};
	}
	if (!new RegExp(PDF_FIXTURE_WORD, 'i').test(answer)) {
		return {
			capability: 'pdf',
			status: 'fail',
			notes: [...notes, `expected "${PDF_FIXTURE_WORD}", got: ${answer.slice(0, 80)}`],
			ms
		};
	}
	return { capability: 'pdf', status: notes.length > 0 ? 'warn' : 'pass', notes, ms };
}

export function checkTools(mat: MaterializedAssistant, ms: number): Verdict {
	const notes: string[] = [];
	const toolTypes = mat.parts.map((p) => p.type).filter((t) => t.startsWith('tool-'));
	if (!toolTypes.includes('tool-getGeocoding')) notes.push('missing tool-getGeocoding call');
	if (!toolTypes.includes('tool-getWeather')) notes.push('missing tool-getWeather call');
	for (const p of mat.parts) {
		if (typeof p.type === 'string' && p.type.startsWith('tool-')) {
			const state = (p as { state?: string }).state;
			if (state !== 'output-available') {
				notes.push(`${p.type} state=${state ?? 'unknown'} (want output-available)`);
			}
		}
	}
	if (
		!/(weather|temperature|°|celsius|fahrenheit|clear|cloud|rain|wind|sunny)/i.test(answerText(mat))
	) {
		notes.push('final answer does not mention weather');
	}
	return { capability: 'tools', status: notes.length === 0 ? 'pass' : 'fail', notes, ms };
}
