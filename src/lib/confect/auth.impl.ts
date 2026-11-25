import { FunctionImpl, GroupImpl } from '@confect/server';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { devNotice } from '../dev/notice';
import databaseSchema from './_generated/schema';
import auth from './auth.spec';
import { onCreate, onDelete, onUpdate } from './authServer';
import { githubOAuth, googleOAuth } from './env';

export default GroupImpl.make(databaseSchema, auth).pipe(
	Layer.provide([
		FunctionImpl.make(databaseSchema, auth, 'getAvailableOAuthProviders', () =>
			Effect.gen(function* () {
				const providers = { google: googleOAuth.enabled, github: githubOAuth.enabled };
				yield* Effect.sync(() => {
					if (!providers.google) {
						devNotice({
							feature: 'Google sign-in',
							missing: ['AUTH_GOOGLE_ID', 'AUTH_GOOGLE_SECRET'],
							scope: 'convex'
						});
					}
					if (!providers.github) {
						devNotice({
							feature: 'GitHub sign-in',
							missing: ['AUTH_GITHUB_ID', 'AUTH_GITHUB_SECRET'],
							scope: 'convex'
						});
					}
				});
				return providers;
			})
		),
		FunctionImpl.make(databaseSchema, auth, 'onCreate', onCreate),
		FunctionImpl.make(databaseSchema, auth, 'onDelete', onDelete),
		FunctionImpl.make(databaseSchema, auth, 'onUpdate', onUpdate)
	]),
	GroupImpl.finalize
);
