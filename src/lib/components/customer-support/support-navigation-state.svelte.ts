import type { SupportView } from './support-types.js';

/**
 * Navigation and URL-coordination state for the support feature.
 *
 * It owns no conversation data. The composition root coordinates navigation
 * changes with the active conversation explicitly.
 */
export class SupportNavigationState {
	currentView = $state<SupportView>('overview');
	shouldOpenWidget = $state(false);
	skipAnimation = $state(false);

	private onThreadChange?: (threadId: string | null) => void;

	setOnThreadChange(callback: ((threadId: string | null) => void) | undefined): void {
		this.onThreadChange = callback;
	}

	setView(view: SupportView): void {
		this.currentView = view;
	}

	showChat(): void {
		this.currentView = 'chat';
	}

	emitThreadChange(threadId: string | null): void {
		this.onThreadChange?.(threadId);
	}

	requestWidgetOpen(hasThread: boolean): void {
		this.shouldOpenWidget = true;
		if (hasThread) this.showChat();
	}

	clearWidgetOpenRequest(): void {
		this.shouldOpenWidget = false;
	}

	selectThread(threadId: string): void {
		this.showChat();
		this.emitThreadChange(threadId);
	}

	selectThreadFromUrl(): void {
		this.showChat();
		this.skipAnimation = true;
	}

	startNewThread(): void {
		this.showChat();
		this.emitThreadChange(null);
	}

	goBack(): void {
		this.currentView = 'overview';
		this.emitThreadChange(null);
	}

	reset(): void {
		this.currentView = 'overview';
		this.shouldOpenWidget = false;
	}
}
