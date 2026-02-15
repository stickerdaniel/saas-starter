import { describe, expect, it } from 'vitest';
import { getMorphTargetIndex, parseMorphTarget } from './morph_to';

describe('morph-to helpers', () => {
	it('maps kinds to specific indexes', () => {
		expect(getMorphTargetIndex('project')).toBe('by_target_project');
		expect(getMorphTargetIndex('task')).toBe('by_target_task');
	});

	it('parses discriminated morph target values', () => {
		expect(parseMorphTarget('project:abc')).toEqual({ kind: 'project', id: 'abc' });
		expect(parseMorphTarget('task:xyz')).toEqual({ kind: 'task', id: 'xyz' });
		expect(parseMorphTarget('invalid:value')).toBe(null);
		expect(parseMorphTarget('project')).toBe(null);
	});
});
