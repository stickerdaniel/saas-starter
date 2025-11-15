<script lang="ts">
	import { T } from '@tolgee/svelte';
	import memberOne from './avatars/member-one.webp';
	import memberTwo from './avatars/member-two.webp';
	import memberThree from './avatars/member-three.webp';
	import memberFour from './avatars/member-four.webp';
	import memberFive from './avatars/member-five.webp';
	import memberSix from './avatars/member-six.webp';

	const members = [
		{
			name: 'Liam Brown',
			roleKey: 'team.roles.founder_ceo',
			avatar: memberOne,
			link: '#'
		},
		{
			name: 'Elijah Jones',
			roleKey: 'team.roles.cofounder_cto',
			avatar: memberTwo,
			link: '#'
		},
		{
			name: 'Isabella Garcia',
			roleKey: 'team.roles.sales_manager',
			avatar: memberThree,
			link: '#'
		},
		{
			name: 'Henry Lee',
			roleKey: 'team.roles.ux_engineer',
			avatar: memberFour,
			link: '#'
		},
		{
			name: 'Ava Williams',
			roleKey: 'team.roles.interaction_designer',
			avatar: memberFive,
			link: '#'
		},
		{
			name: 'Olivia Miller',
			roleKey: 'team.roles.visual_designer',
			avatar: memberSix,
			link: '#'
		}
	];
</script>

<section class="bg-gray-50 py-16 md:py-32 dark:bg-transparent">
	<div class="mx-auto max-w-6xl px-6 lg:px-12">
		<div class="border-t">
			<span class="text-caption -mt-3.5 -ml-6 block w-max bg-gray-50 px-6 dark:bg-gray-950">
				<T keyName="team.section_label" />
			</span>
			<div class="mt-12 gap-4 sm:grid sm:grid-cols-2 md:mt-24">
				<div class="sm:w-2/5">
					<h2 class="text-3xl font-bold sm:text-4xl">
						<T keyName="team.title" />
					</h2>
				</div>
				<div class="mt-6 sm:mt-0">
					<p>
						<T keyName="team.description" />
					</p>
				</div>
			</div>
			<div class="mt-12 md:mt-24">
				<div class="grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
					{#each members as member, index}
						<div class="group overflow-hidden">
							<img
								class="h-96 w-full rounded-md object-cover object-top grayscale transition-all duration-500 group-hover:h-[22.5rem] group-hover:rounded-xl hover:grayscale-0"
								src={member.avatar}
								alt="team member"
								width="826"
								height="1239"
							/>
							<div class="px-2 pt-2 sm:pt-4 sm:pb-0">
								<div class="flex justify-between">
									<h3
										class="text-title text-base font-medium transition-all duration-500 group-hover:tracking-wider"
									>
										{member.name}
									</h3>
									<span class="text-xs">_0{index + 1}</span>
								</div>
								<div class="mt-1 flex items-center justify-between">
									<span
										class="inline-block translate-y-6 text-sm text-muted-foreground opacity-0 transition duration-300 group-hover:translate-y-0 group-hover:opacity-100"
									>
										<T keyName={member.roleKey} />
									</span>
									<a
										href={member.link}
										class="group-hover:text-primary-600 dark:group-hover:text-primary-400 inline-block translate-y-8 text-sm tracking-wide opacity-0 transition-all duration-500 group-hover:translate-y-0 group-hover:opacity-100 hover:underline"
									>
										<T keyName="team.linktree" />
									</a>
								</div>
							</div>
						</div>
					{/each}
				</div>
			</div>
		</div>
	</div>
</section>
