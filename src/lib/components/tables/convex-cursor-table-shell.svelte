<script lang="ts">
	import SearchIcon from '@tabler/icons-svelte/icons/search';
	import ChevronsLeftIcon from '@tabler/icons-svelte/icons/chevrons-left';
	import ChevronsRightIcon from '@tabler/icons-svelte/icons/chevrons-right';
	import ChevronLeftIcon from '@tabler/icons-svelte/icons/chevron-left';
	import ChevronRightIcon from '@tabler/icons-svelte/icons/chevron-right';
	import type { Snippet } from 'svelte';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Select from '$lib/components/ui/select/index.js';

	type Props = {
		testIdPrefix: string;
		searchValue: string;
		searchPlaceholder: string;
		onSearchChange: (value: string) => void;
		pageIndex: number;
		pageCount: number;
		pageSize: number;
		pageSizeOptions: readonly number[];
		canPreviousPage: boolean;
		canNextPage: boolean;
		onFirstPage: () => void;
		onPreviousPage: () => void;
		onNextPage: () => void;
		onLastPage: () => void | Promise<void>;
		onPageSizeChange: (value: number) => void;
		pageIndicatorText: string;
		rowsPerPageLabel?: string;
		selectionText?: string;
		showRowsPerPage?: boolean;
		showSearch?: boolean;
		tableTestId?: string;
		searchTestId?: string;
		pageIndicatorTestId?: string;
		paginationPrevTestId?: string;
		paginationNextTestId?: string;
		paginationLastTestId?: string;
		toolbarFilters?: Snippet;
		toolbarActions?: Snippet;
		tableContent: Snippet;
	};

	let {
		testIdPrefix,
		searchValue,
		searchPlaceholder,
		onSearchChange,
		pageIndex: _pageIndex,
		pageCount: _pageCount,
		pageSize,
		pageSizeOptions,
		canPreviousPage,
		canNextPage,
		onFirstPage,
		onPreviousPage,
		onNextPage,
		onLastPage,
		onPageSizeChange,
		pageIndicatorText,
		rowsPerPageLabel = 'Rows per page',
		selectionText,
		showRowsPerPage = true,
		showSearch = true,
		tableTestId = `${testIdPrefix}-table`,
		searchTestId = `${testIdPrefix}-search`,
		pageIndicatorTestId = `${testIdPrefix}-page-indicator`,
		paginationPrevTestId = `${testIdPrefix}-pagination-prev`,
		paginationNextTestId = `${testIdPrefix}-pagination-next`,
		paginationLastTestId = `${testIdPrefix}-pagination-last`,
		toolbarFilters,
		toolbarActions,
		tableContent
	}: Props = $props();
</script>

<div class="flex flex-col gap-6">
	<div class="flex flex-wrap items-center justify-between gap-4">
		<div class="flex flex-wrap items-center gap-4">
			{#if showSearch}
				<div class="relative w-full max-w-sm sm:w-auto">
					<SearchIcon
						class="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
					/>
					<Input
						type="search"
						placeholder={searchPlaceholder}
						class="w-full pl-10 sm:w-64"
						data-testid={searchTestId}
						value={searchValue}
						oninput={(event) => onSearchChange((event.currentTarget as HTMLInputElement).value)}
					/>
				</div>
			{/if}

			{@render toolbarFilters?.()}
		</div>

		{@render toolbarActions?.()}
	</div>

	<div class="overflow-hidden rounded-md border" data-testid={tableTestId}>
		{@render tableContent()}
	</div>

	<div class="flex items-center justify-between px-2">
		<div class="hidden flex-1 text-sm text-muted-foreground lg:flex">
			{selectionText}
		</div>

		<div class="flex w-full items-center gap-8 lg:w-fit">
			{#if showRowsPerPage}
				<div class="hidden items-center gap-2 lg:flex">
					<span class="text-sm font-medium">{rowsPerPageLabel}</span>
					<Select.Root
						type="single"
						value={`${pageSize}`}
						onValueChange={(value) => onPageSizeChange(Number(value))}
					>
						<Select.Trigger size="sm" class="w-20">
							{pageSize}
						</Select.Trigger>
						<Select.Content side="top">
							{#each pageSizeOptions as option (option)}
								<Select.Item value={`${option}`}>{option}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
			{/if}

			<div
				class="flex w-fit items-center justify-center text-sm font-medium"
				data-testid={pageIndicatorTestId}
			>
				{pageIndicatorText}
			</div>

			<div class="ml-auto flex items-center gap-2 lg:ml-0">
				<Button
					variant="outline"
					class="hidden h-8 w-8 p-0 lg:flex"
					onclick={onFirstPage}
					disabled={!canPreviousPage}
				>
					<span class="sr-only">First page</span>
					<ChevronsLeftIcon />
				</Button>
				<Button
					variant="outline"
					class="size-8"
					size="icon"
					onclick={onPreviousPage}
					disabled={!canPreviousPage}
					data-testid={paginationPrevTestId}
				>
					<span class="sr-only">Previous page</span>
					<ChevronLeftIcon />
				</Button>
				<Button
					variant="outline"
					class="size-8"
					size="icon"
					onclick={onNextPage}
					disabled={!canNextPage}
					data-testid={paginationNextTestId}
				>
					<span class="sr-only">Next page</span>
					<ChevronRightIcon />
				</Button>
				<Button
					variant="outline"
					class="hidden h-8 w-8 p-0 lg:flex"
					onclick={() => void onLastPage()}
					disabled={!canNextPage}
					data-testid={paginationLastTestId}
				>
					<span class="sr-only">Last page</span>
					<ChevronsRightIcon />
				</Button>
			</div>
		</div>
	</div>
</div>
