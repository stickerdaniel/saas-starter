/** Credentials of an email/password account a spec or fixture created. */
export interface TestAccount {
	email: string;
	password: string;
	name: string;
}

export type AccountRole = 'user' | 'admin';

/** A worker account with the path of its saved signed-in browser state. */
export interface WorkerAccount extends TestAccount {
	storageState: string;
}

/** The two accounts every authenticated worker signs in with. */
export type WorkerAccounts = Record<AccountRole, WorkerAccount>;
