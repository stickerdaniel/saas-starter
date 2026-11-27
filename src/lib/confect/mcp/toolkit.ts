import * as Layer from 'effect/Layer';
import * as Toolkit from 'effect/ai/Toolkit';
import type refs from '../_generated/refs';
import { LEGAL_CONFIG } from '../../config/legal';
import { AccountTools, AccountToolsLive } from './tools/account';
import { CommunityTools, CommunityToolsLive } from './tools/community';

export const MCP_SERVER = {
	name: LEGAL_CONFIG.brandName.toLowerCase().replaceAll(' ', '-'),
	version: '1.0.0'
};

export const AppToolkit = Toolkit.merge(AccountTools, CommunityTools);

export const AppToolkitLive = (functions: typeof refs) =>
	Layer.mergeAll(AccountToolsLive(functions), CommunityToolsLive(functions));
