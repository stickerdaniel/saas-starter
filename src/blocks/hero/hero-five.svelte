<script>
	import { T, getTranslate } from '@tolgee/svelte';
	import { localizedHref } from '$lib/utils/i18n';

	const { t } = getTranslate();

	import { Marquee } from '$lib/components/spell/marquee';
	import ProgressiveBlur from '../magic/ProgressiveBlur.svelte';
	import HeroFiveCta from '$lib/components/ui/owned/hero-five-cta.svelte';
	import LearnMoreChevron from '$lib/components/motion/learn-more-chevron.svelte';
	import RiveBackground from '$lib/components/RiveBackground.svelte';
	import nvidiaLogo from './logos/nvidia.svg';
	import columnLogo from './logos/column.svg';
	import githubLogo from './logos/github.svg';
	import nikeLogo from './logos/nike.svg';
	import lemonsqueezyLogo from './logos/lemonsqueezy.svg';
	import laravelLogo from './logos/laravel.svg';
	import lillyLogo from './logos/lilly.svg';
	import openaiLogo from './logos/openai.svg';
</script>

<div class="overflow-hidden">
	<section class="relative flex items-center justify-center">
		<RiveBackground
			src="/animations/spring-demo.riv"
			stateMachine="Motion"
			defer
			desktopOnly
			class="absolute -bottom-1/5 h-137.5 w-137.5 lg:-bottom-1/6 lg:left-9/20 lg:h-175 lg:w-175 xl:left-13/25"
		/>

		<div class="pointer-events-none w-full pt-20 pb-56 lg:pt-40 lg:pb-36">
			<div class="relative mx-auto flex max-w-6xl flex-col px-6 lg:block lg:px-12">
				<div class="mx-auto max-w-lg text-center lg:ml-0 lg:max-w-full lg:text-left">
					<h1 class="mt-8 max-w-4xl text-5xl md:text-6xl lg:mt-16 xl:text-7xl">
						<span class="whitespace-pre-line"><T keyName="hero.tagline" /></span>
					</h1>
					<p class="mt-8 max-w-3xl text-lg text-balance">
						<T keyName="hero.description" />
					</p>
					<div
						class="mt-12 flex flex-col items-center justify-center gap-2 sm:flex-row lg:justify-start"
					>
						<HeroFiveCta emphasis="primary" href={localizedHref('/signup')}>
							<span class="text-nowrap"><T keyName="hero.cta" /></span>
							<LearnMoreChevron class="ml-1" />
						</HeroFiveCta>
						<HeroFiveCta emphasis="demo" href="#link">
							<span class="text-nowrap"><T keyName="hero.cta_demo" /></span>
						</HeroFiveCta>
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
	<section>
		<div class="group relative m-auto max-w-6xl px-6">
			<div class="flex flex-col items-center md:flex-row">
				<div class="md:max-w-44 md:border-r md:pr-6">
					<p class="text-end text-sm"><T keyName="hero.companies_text" /></p>
				</div>
				<!-- Checkout Logo Cloud Three  -->
				<!-- I have provided progressive blur snippet code & Marquee code -->
				<div class="relative py-6 md:w-[calc(100%-11rem)]">
					<Marquee fade={false} duration={16}>
						<div class="flex items-center gap-12 pr-12">
							<img
								class="h-5 dark:invert"
								src={nvidiaLogo}
								alt={$t('hero.logo_alt', { name: 'Nvidia' })}
								width="106"
								height="20"
							/>
							<img
								class="h-4 dark:invert"
								src={columnLogo}
								alt={$t('hero.logo_alt', { name: 'Column' })}
								width="73"
								height="16"
							/>
							<img
								class="h-4 dark:invert"
								src={githubLogo}
								alt={$t('hero.logo_alt', { name: 'GitHub' })}
								width="60"
								height="16"
							/>
							<img
								class="h-5 dark:invert"
								src={nikeLogo}
								alt={$t('hero.logo_alt', { name: 'Nike' })}
								width="56"
								height="20"
							/>
							<img
								class="h-5 dark:invert"
								src={lemonsqueezyLogo}
								alt={$t('hero.logo_alt', { name: 'Lemon Squeezy' })}
								width="153"
								height="20"
							/>
							<img
								class="h-4 dark:invert"
								src={laravelLogo}
								alt={$t('hero.logo_alt', { name: 'Laravel' })}
								width="65"
								height="16"
							/>
							<img
								class="h-7 dark:invert"
								src={lillyLogo}
								alt={$t('hero.logo_alt', { name: 'Lilly' })}
								width="53"
								height="28"
							/>
							<img
								class="h-6 dark:invert"
								src={openaiLogo}
								alt={$t('hero.logo_alt', { name: 'OpenAI' })}
								width="84"
								height="24"
							/>
						</div>
					</Marquee>

					<div class="absolute inset-y-0 left-0 w-20 bg-linear-to-r from-background"></div>
					<div class="absolute inset-y-0 right-0 w-20 bg-linear-to-l from-background"></div>
					<ProgressiveBlur
						class="pointer-events-none absolute top-0 left-0 z-10 h-full w-20"
						direction="left"
						blurIntensity={1}
					/>
					<ProgressiveBlur
						class="pointer-events-none absolute top-0 right-0 z-10 h-full w-20"
						direction="right"
						blurIntensity={1}
					/>
				</div>
			</div>
		</div>
	</section>
</div>
