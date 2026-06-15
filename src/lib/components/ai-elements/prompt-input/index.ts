// Main component
export { default as PromptInput } from './PromptInput.svelte';
export { default as PromptInputProvider } from './PromptInputProvider.svelte';

// Form components
export { default as PromptInputBody } from './PromptInputBody.svelte';
export { default as PromptInputTextarea } from './PromptInputTextarea.svelte';
export { default as PromptInputToolbar } from './PromptInputToolbar.svelte';
export { default as PromptInputTools } from './PromptInputTools.svelte';
export { default as PromptInputButton } from './PromptInputButton.svelte';

// Attachment components
export { default as PromptInputAttachment } from './PromptInputAttachment.svelte';
export { default as PromptInputAttachments } from './PromptInputAttachments.svelte';

// Action menu components
export { default as PromptInputActionMenu } from './PromptInputActionMenu.svelte';
export { default as PromptInputActionMenuTrigger } from './PromptInputActionMenuTrigger.svelte';
export { default as PromptInputActionMenuContent } from './PromptInputActionMenuContent.svelte';
export { default as PromptInputActionMenuItem } from './PromptInputActionMenuItem.svelte';
export { default as PromptInputActionAddAttachments } from './PromptInputActionAddAttachments.svelte';

// Submit component
export { default as PromptInputSubmit } from './PromptInputSubmit.svelte';

// Model select components
export { default as PromptInputModelSelect } from './PromptInputModelSelect.svelte';
export { default as PromptInputModelSelectTrigger } from './PromptInputModelSelectTrigger.svelte';
export { default as PromptInputModelSelectContent } from './PromptInputModelSelectContent.svelte';
export { default as PromptInputModelSelectItem } from './PromptInputModelSelectItem.svelte';
export { default as PromptInputModelSelectValue } from './PromptInputModelSelectValue.svelte';

// Icon components
export { default as ImageIcon } from '@lucide/svelte/icons/image';
export { default as Loader2Icon } from '@lucide/svelte/icons/loader-circle';
export { default as PaperclipIcon } from '@lucide/svelte/icons/paperclip';
export { default as PlusIcon } from '@lucide/svelte/icons/plus';
export { default as SendIcon } from '@lucide/svelte/icons/send';
export { default as SquareIcon } from '@lucide/svelte/icons/square';
export { default as XIcon } from '@lucide/svelte/icons/x';
export { default as GlobeIcon } from '@lucide/svelte/icons/globe';
export { default as MicIcon } from '@lucide/svelte/icons/mic';

// Context and types
export {
	AttachmentsContext,
	attachmentsContext,
	PromptInputController,
	TextInputController,
	promptInputProviderContext,
	type FileUIPart,
	type FileWithId,
	type PromptInputMessage,
	type ChatStatus
} from './attachments-context.svelte.js';
