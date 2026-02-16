import { describe, expect, it } from 'vitest';
import {
	getMorphTargetIndex,
	parseMorphTarget,
	serializeMorphTarget,
	toMorphIndexFields
} from './morph_to';

describe('morph-to helpers', () => {
	it('maps kinds to specific indexes', () => {
		expect(
			getMorphTargetIndex('project', {
				project: 'by_target_project',
				task: 'by_target_task'
			})
		).toBe('by_target_project');
		expect(
			getMorphTargetIndex('task', {
				project: 'by_target_project',
				task: 'by_target_task'
			})
		).toBe('by_target_task');
	});

	it('parses discriminated morph target values', () => {
		expect(parseMorphTarget('project:abc', ['project', 'task'])).toEqual({
			kind: 'project',
			id: 'abc'
		});
		expect(parseMorphTarget('task:xyz', ['project', 'task'])).toEqual({
			kind: 'task',
			id: 'xyz'
		});
		expect(parseMorphTarget('invalid:value', ['project', 'task'])).toBe(null);
		expect(parseMorphTarget('project')).toBe(null);
	});

	it('serializes and resolves index field payloads', () => {
		expect(serializeMorphTarget({ kind: 'project', id: 'abc' })).toBe('project:abc');
		expect(
			toMorphIndexFields(
				{ kind: 'project', id: 'abc' },
				{
					project: 'targetProjectId',
					task: 'targetTaskId'
				}
			)
		).toEqual({
			targetProjectId: 'abc',
			targetTaskId: undefined
		});
	});
});
