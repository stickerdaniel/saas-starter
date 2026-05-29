import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModelMessage } from 'ai';

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function readFixture(name: string): Uint8Array {
	return new Uint8Array(readFileSync(join(FIXTURE_DIR, name)));
}

/** The literal string baked into doc.pdf; the pdf check looks for it in the answer. */
export const PDF_FIXTURE_WORD = 'ModelEvalFixture';

// A concrete, well-known prompt: it elicits a short reasoning trace and a finite
// answer on any capable model. Niche prompts induce unbounded, high-variance
// reasoning that can stall before any answer is emitted.
const TEXT_PROMPT = 'In two short sentences, explain what a REST API is.';
const IMAGE_PROMPT = 'What animal is shown in this photo? Reply with one word.';
const PDF_PROMPT =
	'What is the exact fixture word written in this PDF? Reply with that one word only.';
const TOOLS_PROMPT = "What's the weather in Tokyo right now? Use the weather tools.";

export function textMessages(): ModelMessage[] {
	return [{ role: 'user', content: TEXT_PROMPT }];
}

// Images and PDFs are both sent as file parts with a mediaType, mirroring how
// the app delivers attachments (getFile -> filePart) to the agent.
export function imageMessages(): ModelMessage[] {
	return [
		{
			role: 'user',
			content: [
				{ type: 'text', text: IMAGE_PROMPT },
				{
					type: 'file',
					data: readFixture('cat.webp'),
					mediaType: 'image/webp',
					filename: 'cat.webp'
				}
			]
		}
	];
}

export function pdfMessages(): ModelMessage[] {
	return [
		{
			role: 'user',
			content: [
				{ type: 'text', text: PDF_PROMPT },
				{
					type: 'file',
					data: readFixture('doc.pdf'),
					mediaType: 'application/pdf',
					filename: 'doc.pdf'
				}
			]
		}
	];
}

export function toolsMessages(): ModelMessage[] {
	return [{ role: 'user', content: TOOLS_PROMPT }];
}
