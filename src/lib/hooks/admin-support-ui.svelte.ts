import { Context } from 'runed';

/**
 * UI state for the admin support details overlay (Sheet/Drawer).
 *
 * Provided via context from the admin support page so each SSR request gets
 * its own instance; `detailsOpen` is read during SSR via `bind:open`, so a
 * module-scope singleton would be shared across concurrent requests.
 */
export class AdminSupportUIManager {
	detailsOpen = $state(false);

	toggle() {
		this.detailsOpen = !this.detailsOpen;
	}

	close() {
		this.detailsOpen = false;
	}
}

export const adminSupportUIContext = new Context<AdminSupportUIManager>('admin-support-ui');
