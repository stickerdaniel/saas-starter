import fs from 'fs';
import path from 'path';

export function testBackendUrlFile(cwd = process.cwd()): string {
	return path.join(cwd, '.convex', '.test-backend-url');
}

export function testSiteUrlFile(cwd = process.cwd()): string {
	return path.join(cwd, '.convex', '.test-site-url');
}

export function invalidateLocalTestBackendUrl(cwd = process.cwd()): void {
	fs.rmSync(testBackendUrlFile(cwd), { force: true });
	fs.rmSync(testSiteUrlFile(cwd), { force: true });
}
