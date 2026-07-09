import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

// Regression guard for slow, uncacheable avatar delivery.
//
// updateProfileImage must never hand out the files-control component's
// /files/download URLs for avatars: that route forces `Cache-Control:
// no-store` + `Content-Disposition: attachment` and proxy-streams the file
// body through the httpAction (measured 4-16s for a 310KB avatar), so every
// avatar render re-downloaded the file and lost the race against UI entrance
// animations (support-widget greeting). Avatars go through the app's
// /files/inline redirect route instead, which 302s to the browser-cacheable
// storage URL.
//
// This guards the "two separate data sources must agree" class: the URL
// storage.ts builds and the route http.ts registers.
describe('avatar inline route agreement', () => {
	const storageSrc = fs.readFileSync(path.resolve('src/lib/convex/storage.ts'), 'utf-8');
	const httpSrc = fs.readFileSync(path.resolve('src/lib/convex/http.ts'), 'utf-8');

	it('storage.ts builds /files/inline URLs, not component download URLs', () => {
		expect(storageSrc).toContain('/files/inline?token=');
		expect(storageSrc).not.toContain('buildDownloadUrl');
	});

	it('http.ts registers the /files/inline route those URLs point at', () => {
		expect(httpSrc).toContain("path: '/files/inline'");
	});
});
