import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const facade = readFileSync(resolve('src/lib/chat/ui/chat-context.svelte.ts'), 'utf8');
const coordinator = readFileSync(
	resolve('src/lib/chat/ui/composer-attachment-coordinator.svelte.ts'),
	'utf8'
);
const transfer = readFileSync(resolve('src/lib/chat/ui/attachment-transfer.ts'), 'utf8');

describe('AttachmentTransfer ownership boundary', () => {
	it('keeps attempt ownership in AttachmentTransfer behind the coordinator', () => {
		expect(coordinator).toContain('new AttachmentTransfer({');
		expect(coordinator).toContain('private readonly transfers');
		expect(facade).not.toContain('new AttachmentTransfer({');
		expect(facade).not.toContain('private readonly transfers');
		expect(facade).not.toContain('uploadAborters');
		expect(facade).not.toContain('retryJobs');
		expect(facade).not.toContain('private async runUpload');
	});

	it('keeps collection, parking, and persistence out of the transfer', () => {
		expect(transfer).toContain('export class AttachmentTransfer');
		expect(transfer).not.toContain("from './chat-context");
		expect(transfer).not.toContain("from './composer-attachment-coordinator");
		expect(transfer).not.toContain('SvelteMap');
		expect(transfer).not.toContain('attachmentStore');
		expect(transfer).not.toContain('private readonly attachments');
		expect(transfer).not.toContain('private readonly parked');
		expect(transfer).not.toContain('persist(');
	});
});
