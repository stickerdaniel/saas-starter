#!/usr/bin/env node

import { exportJWK, exportPKCS8, generateKeyPair } from 'jose';
import { execSync } from 'child_process';

console.log('🔑 Generating JWT keys for Convex Auth...');

// Generate keys
const keys = await generateKeyPair('RS256', {
	extractable: true
});

const privateKey = await exportPKCS8(keys.privateKey);
const publicKey = await exportJWK(keys.publicKey);
const jwks = JSON.stringify({ keys: [{ use: 'sig', ...publicKey }] });

// Format private key for environment variable (replace newlines with spaces)
const formattedPrivateKey = privateKey.trimEnd().replace(/\n/g, ' ');

console.log('✅ Keys generated successfully');

try {
	console.log('🔧 Setting JWT_PRIVATE_KEY in Convex...');
	execSync(`bun convex env set JWT_PRIVATE_KEY -- "${formattedPrivateKey}"`, {
		stdio: 'inherit'
	});

	console.log('🔧 Setting JWKS in Convex...');
	execSync(`bun convex env set JWKS -- '${jwks}'`, {
		stdio: 'inherit'
	});

	console.log('🎉 Authentication keys configured successfully!');
	console.log('Your Convex Auth setup is now complete.');
} catch (error) {
	console.error('❌ Error setting environment variables:');
	console.error(error.message);
	console.log('\n📋 Manual setup fallback:');
	console.log(`JWT_PRIVATE_KEY="${formattedPrivateKey}"`);
	console.log(`JWKS=${jwks}`);
	process.exit(1);
}
