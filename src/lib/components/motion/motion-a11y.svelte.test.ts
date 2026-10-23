import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = import.meta.dirname;

describe('motion attachments', () => {
	const avatar = readFileSync(join(dir, 'avatar-group-hover.svelte.ts'), 'utf8');
	const overview = readFileSync(join(dir, '../customer-support/threads-overview.svelte'), 'utf8');

	it('attaches and tears down the avatar lifecycle', () => {
		expect(avatar).toContain('Attachment<HTMLElement>');
		expect(avatar).toContain("hoverCapable.removeEventListener('change', syncCapability);");
		expect(avatar).toContain('observer?.disconnect();');
		expect(avatar).toContain('disable();');
		expect(overview).toContain('{@attach avatarGroupHover}');
		expect(overview).not.toContain('use:avatarGroupHover');
	});
});
