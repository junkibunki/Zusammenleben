<script>
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import { auth } from '$lib/pocketbase.svelte.js';
	import { syncFollows } from '$lib/training-follows.svelte.js';
	import FollowPeople from './FollowPeople.svelte';
	import { Button } from '$lib/components/ui/button/index.js';

	// Wem man folgt, plus Suche nach weiteren Personen. Erreichbar ueber das
	// Personen-Icon oben im Feed.

	const userId = $derived(auth.user?.id ?? '');

	$effect(() => {
		if (userId) return syncFollows();
	});
</script>

<main class="flex flex-1 flex-col gap-4 px-3 py-4">
	<div>
		<Button href="/training/feed" variant="ghost" class="text-muted-foreground -ml-2 h-11">
			<ArrowLeftIcon class="size-4" />
			Feed
		</Button>
	</div>

	<FollowPeople />
</main>
