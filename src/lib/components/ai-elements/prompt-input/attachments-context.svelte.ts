import { Context } from 'runed';

export interface FileUIPart {
	type: 'file';
	url?: string;
	mediaType?: string;
	filename?: string;
}

export interface FileWithId extends FileUIPart {
	id: string;
}

export interface PromptInputMessage {
	text?: string;
	files?: FileUIPart[];
}

export type ChatStatus = 'submitted' | 'streaming' | 'error' | 'idle';

export class AttachmentsContext {
	files = $state<FileWithId[]>([]);
	fileInputRef = $state<HTMLInputElement | null>(null);

	constructor(
		private accept?: string,
		private multiple?: boolean,
		private maxFiles?: number,
		private maxFileSize?: number,
		private onError?: (err: {
			code: 'max_files' | 'max_file_size' | 'accept';
			message: string;
		}) => void
	) {}

	openFileDialog = () => {
		this.fileInputRef?.click();
	};

	matchesAccept = (file: File): boolean => {
		if (!this.accept || this.accept.trim() === '') {
			return true;
		}
		if (this.accept.includes('image/*')) {
			return file.type.startsWith('image/');
		}
		return true;
	};

	add = (files: File[] | FileList) => {
		const incoming = Array.from(files);
		const accepted = incoming.filter((f) => this.matchesAccept(f));

		if (accepted.length === 0) {
			this.onError?.({
				code: 'accept',
				message: 'No files match the accepted types.'
			});
			return;
		}

		const withinSize = (f: File) => (this.maxFileSize ? f.size <= this.maxFileSize : true);
		const sized = accepted.filter(withinSize);

		if (sized.length === 0 && accepted.length > 0) {
			this.onError?.({
				code: 'max_file_size',
				message: 'All files exceed the maximum size.'
			});
			return;
		}

		const capacity =
			typeof this.maxFiles === 'number'
				? Math.max(0, this.maxFiles - this.files.length)
				: undefined;
		const capped = typeof capacity === 'number' ? sized.slice(0, capacity) : sized;

		if (typeof capacity === 'number' && sized.length > capacity) {
			this.onError?.({
				code: 'max_files',
				message: 'Too many files. Some were not added.'
			});
		}

		const next: FileWithId[] = [];
		for (const file of capped) {
			next.push({
				id: crypto.randomUUID(),
				type: 'file',
				url: URL.createObjectURL(file),
				mediaType: file.type,
				filename: file.name
			});
		}

		this.files = [...this.files, ...next];
	};

	remove = (id: string) => {
		const found = this.files.find((file) => file.id === id);
		if (found?.url) {
			URL.revokeObjectURL(found.url);
		}
		this.files = this.files.filter((file) => file.id !== id);
	};

	clear = () => {
		for (const file of this.files) {
			if (file.url) {
				URL.revokeObjectURL(file.url);
			}
		}
		this.files = [];
	};
}

// ============================================================================
// Provider Context for Global State Management
// ============================================================================

export class TextInputController {
	value = $state('');

	setInput = (newValue: string) => {
		this.value = newValue;
	};

	clear = () => {
		this.value = '';
	};
}

export class PromptInputController {
	textInput: TextInputController;
	attachments: AttachmentsContext;

	constructor(initialInput = '', accept?: string, multiple?: boolean) {
		this.textInput = new TextInputController();
		this.textInput.value = initialInput;
		this.attachments = new AttachmentsContext(accept, multiple);
	}
}

export const attachmentsContext = new Context<AttachmentsContext>('attachments');
export const promptInputProviderContext = new Context<PromptInputController>(
	'prompt-input-provider'
);
