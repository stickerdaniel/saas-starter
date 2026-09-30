// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
	assertMetadata,
	verifiedCloudflarePreview,
	backendKey,
	cases,
	reconcile,
	shardCount,
	type Report
} from './e2e-ci';
function report(ids: string[]): Report {
	return {
		suites: [
			{
				specs: ids.map((id) => ({
					id,
					tests: [
						{
							projectName: 'public',
							expectedStatus: 'passed',
							status: 'expected',
							results: [{ status: 'passed' }]
						}
					]
				}))
			}
		]
	};
}
describe('complete preview result aggregation', () => {
	it('requires each collected case exactly once, independently of lane count', () => {
		const inventory = report(['a', 'b', 'c']);
		expect(reconcile(inventory, [report(['a']), report(['b', 'c'])]).cases).toBe(3);
		expect(() => reconcile(inventory, [report(['a']), report(['b'])])).toThrow('Missing execution');
		expect(() => reconcile(inventory, [report(['a', 'b']), report(['b', 'c'])])).toThrow(
			'Duplicate execution'
		);
		expect(() => reconcile(inventory, [report([])])).toThrow('Empty E2E shard');
		const failed = report(['a', 'b', 'c']);
		cases(failed).values().next().value!.status = 'unexpected';
		expect(() => reconcile(inventory, [failed])).toThrow('did not pass');
	});
	it('rejects incomplete lifecycle evidence and unexecuted cases', () => {
		const failed = report(['a']);
		failed.errors = [{ message: 'cleanup failed' }];
		expect(() => reconcile(report(['a']), [failed])).toThrow('lifecycle');
		delete failed.errors;
		cases(failed).values().next().value!.results = [];
		expect(() => reconcile(report(['a']), [failed])).toThrow('did not pass');
	});
	it('fails on a moving frontend or mismatched backend', () => {
		const config = { convexUrl: 'https://a.convex.cloud', convexSiteUrl: 'https://a.convex.site' };
		const expected = { ...config, sha: 'abc' };
		expect(() => assertMetadata({ version: 'abc' }, config, expected)).not.toThrow();
		expect(() => assertMetadata({ version: 'old' }, config, expected)).toThrow('revision');
		expect(() =>
			assertMetadata(
				{ version: 'abc' },
				{ ...config, convexUrl: 'https://b.convex.cloud' },
				expected
			)
		).toThrow('discovery');
	});
	it('validates counts and keys the writer lock by canonical backend origin', () => {
		expect(shardCount(undefined)).toBe(1);
		expect(shardCount('3')).toBe(3);
		for (const bad of ['0', '-1', '1.5', '33', 'two']) expect(() => shardCount(bad)).toThrow();
		expect(backendKey('https://a.convex.cloud')).toBe(backendKey('https://a.convex.cloud/'));
		expect(backendKey('https://a.convex.cloud')).not.toBe(backendKey('https://b.convex.cloud'));
	});
});

it('admits only preview origins emitted by the trusted provider for the tested commit', () => {
	const sha = 'a'.repeat(40);
	// Shape and URL lines follow the actual Workers check-run response.
	const check = {
		head_sha: sha,
		conclusion: 'success',
		app: { slug: 'cloudflare-workers-and-pages' },
		output: {
			summary:
				'\nPreview URL: https://version-starter.example.workers.dev\nPreview Alias URL: https://branch-starter.example.workers.dev\n'
		}
	};
	expect(
		verifiedCloudflarePreview('https://branch-starter.example.workers.dev/', sha, [check])
	).toBe('https://branch-starter.example.workers.dev');
	for (const input of [
		'https://attacker.example.com',
		'http://branch-starter.example.workers.dev',
		'https://branch-starter.example.workers.dev@attacker.example.com',
		'https://branch-starter.example.workers.dev/?redirect=evil'
	])
		expect(() => verifiedCloudflarePreview(input, sha, [check])).toThrow();
	expect(() =>
		verifiedCloudflarePreview('https://branch-starter.example.workers.dev', sha, [
			{ ...check, app: { slug: 'github-actions' } }
		])
	).toThrow('successful Cloudflare');
	expect(() =>
		verifiedCloudflarePreview('https://branch-starter.example.workers.dev', sha, [
			{ ...check, head_sha: 'b'.repeat(40) }
		])
	).toThrow('successful Cloudflare');
});
