<script>
	import Marquee from '../magic/Marquee.svelte';
	import ProgressiveBlur from '../magic/ProgressiveBlur.svelte';
	import Button from '$lib/components/ui/button/button.svelte';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
</script>

<main class="overflow-x-hidden">
	<section>
		<div class="py-24 md:pb-32 lg:pt-48 lg:pb-36">
			<div class="relative mx-auto flex max-w-7xl flex-col px-6 lg:block lg:px-12">
				<div class="mx-auto max-w-lg text-center lg:ml-0 lg:max-w-full lg:text-left">
					<h1 class="mt-8 max-w-3xl text-5xl text-balance md:text-6xl lg:mt-16 xl:text-7xl">
						Focus on your product and ship faster
					</h1>
					<p class="mt-8 max-w-3xl text-lg text-balance">
						Build your brand in minutes, not weeks.<br />Another saas-template, but this time with
						the perfect tech stack
					</p>

					<div
						class="mt-12 flex flex-col items-center justify-center gap-2 sm:flex-row lg:justify-start"
					>
						<Button size="lg" href="#" class="h-12 rounded-full pr-3 pl-5 text-base">
							<span class="text-nowrap">Start Building</span>
							<ChevronRight class="ml-1" />
						</Button>
						<Button
							size="lg"
							variant="ghost"
							href="#link"
							class="h-12 rounded-full px-5 text-base hover:bg-zinc-950/5 dark:hover:bg-white/5"
						>
							<span class="text-nowrap">Request a demo</span>
						</Button>
					</div>
				</div>
			</div>
			<!-- <div
        class="aspect-2/3 absolute inset-1 -z-10 overflow-hidden rounded-3xl border border-black/10 lg:aspect-video lg:rounded-[3rem] dark:border-white/5"
      >
        <video
          autoPlay
          loop
          class="size-full -scale-x-100 object-cover opacity-50 invert dark:opacity-35 dark:invert-0 dark:lg:opacity-75"
          src="https://res.cloudinary.com/dg4jhba5c/video/upload/v1741605033/dna_ttplyu.mp4"
        ></video>
      </div> -->
		</div>
	</section>
	<section class="bg-background pb-2">
		<div class="group relative m-auto max-w-7xl px-6">
			<div class="flex flex-col items-center md:flex-row">
				<div class="md:max-w-44 md:border-r md:pr-6">
					<p class="text-end text-sm">Powering the best teams</p>
				</div>
				<!-- Checkout Logo Cloud Three  -->
				<!-- I have provided progressive blur snippet code & Marquee code -->
				<div class="relative py-6 md:w-[calc(100%-11rem)]">
					<Marquee>
						<div class="flex">
							<img
								class="mx-auto h-5 w-fit dark:invert"
								src="https://html.tailus.io/blocks/customers/nvidia.svg"
								alt="Nvidia Logo"
								height="20"
								width="auto"
							/>
						</div>
						<div class="flex">
							<img
								class="mx-auto h-4 w-fit dark:invert"
								src="https://html.tailus.io/blocks/customers/column.svg"
								alt="Column Logo"
								height="16"
								width="auto"
							/>
						</div>
						<div class="flex">
							<img
								class="mx-auto h-4 w-fit dark:invert"
								src="https://html.tailus.io/blocks/customers/github.svg"
								alt="GitHub Logo"
								height="16"
								width="auto"
							/>
						</div>
						<div class="flex">
							<img
								class="mx-auto h-5 w-fit dark:invert"
								src="https://html.tailus.io/blocks/customers/nike.svg"
								alt="Nike Logo"
								height="20"
								width="auto"
							/>
						</div>
						<div class="flex">
							<img
								class="mx-auto h-5 w-fit dark:invert"
								src="https://html.tailus.io/blocks/customers/lemonsqueezy.svg"
								alt="Lemon Squeezy Logo"
								height="20"
								width="auto"
							/>
						</div>
						<div class="flex">
							<img
								class="mx-auto h-4 w-fit dark:invert"
								src="https://html.tailus.io/blocks/customers/laravel.svg"
								alt="Laravel Logo"
								height="16"
								width="auto"
							/>
						</div>
						<div class="flex">
							<img
								class="mx-auto h-7 w-fit dark:invert"
								src="https://html.tailus.io/blocks/customers/lilly.svg"
								alt="Lilly Logo"
								height="28"
								width="auto"
							/>
						</div>
						<div class="flex">
							<img
								class="mx-auto h-6 w-fit dark:invert"
								src="https://html.tailus.io/blocks/customers/openai.svg"
								alt="OpenAI Logo"
								height="24"
								width="auto"
							/>
						</div>
					</Marquee>

					<div class="absolute inset-y-0 left-0 w-20 bg-linear-to-r from-background"></div>
					<div class="absolute inset-y-0 right-0 w-20 bg-linear-to-l from-background"></div>
					<ProgressiveBlur
						class="pointer-events-none absolute top-0 left-0 z-50 h-full w-20"
						direction="left"
						blurIntensity={1}
					/>
					<ProgressiveBlur
						class="pointer-events-none absolute top-0 right-0 z-50 h-full w-20"
						direction="right"
						blurIntensity={1}
					/>
				</div>
			</div>
		</div>
	</section>
</main>
