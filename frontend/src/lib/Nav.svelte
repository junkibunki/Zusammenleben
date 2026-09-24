<script>
	import { page } from '$app/state';
	import MenuIcon from '@lucide/svelte/icons/menu';
	import ShoppingCartIcon from '@lucide/svelte/icons/shopping-cart';
	import CarIcon from '@lucide/svelte/icons/car';
	import LightbulbIcon from '@lucide/svelte/icons/lightbulb';
	import EuroIcon from '@lucide/svelte/icons/euro';
	import GiftIcon from '@lucide/svelte/icons/gift';
	import UsersIcon from '@lucide/svelte/icons/users';
	import UserIcon from '@lucide/svelte/icons/user';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import HouseIcon from '@lucide/svelte/icons/house';
	import { auth, logout, avatarUrl } from '$lib/pocketbase.svelte.js';
	import { tapAvatar } from '$lib/easteregg.svelte.js';
	import { households, activeHousehold, carName } from '$lib/households.svelte.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import * as Avatar from '$lib/components/ui/avatar/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';

	// `title` steht in der Leiste, `label` im Menue -- die Startseite heisst dort
	// nach ihrem Inhalt, oben aber weiter nach der App. Das Auto heisst in jedem
	// Haushalt anders (`households.car_name`).
	const car = $derived(carName());
	const LINKS = $derived([
		{ href: '/', label: 'Einkaufszettel', title: 'Einkaufsliste', icon: ShoppingCartIcon },
		{ href: '/ausgaben', label: 'Ich habe bezahlt', title: 'Ausgaben', icon: EuroIcon },
		{ href: '/gundula', label: `Wo ist ${car}`, title: `Wo ist ${car}`, icon: CarIcon },
		{
			href: '/ideen',
			label: 'Neue Ideen für den grünen Freund',
			title: 'Ideen für den grünen Freund',
			icon: LightbulbIcon
		},
		{ href: '/wuensche', label: 'Wünsch dir was', title: 'Wünsch dir was', icon: GiftIcon },
		{ href: '/residents', label: 'Bewohner', title: 'Bewohner', icon: UsersIcon },
		{ href: '/profile', label: 'Profil', title: 'Profil', icon: UserIcon }
	]);

	let open = $state(false);

	// Jede Navigation schliesst die Schublade -- auch Zurueck/Vorwaerts.
	$effect(() => {
		page.url.pathname;
		open = false;
	});

	// Die Detailseite steht nicht im Menue, braucht oben aber trotzdem ihren
	// eigenen Titel -- sonst hiesse sie wie die Liste, von der sie kommt.
	const title = $derived(
		page.url.pathname.startsWith('/items/')
			? 'Eintrag'
			: page.url.pathname === '/haushalte'
				? 'Haushalte'
				: (LINKS.find((l) => l.href === page.url.pathname)?.title ?? 'Einkaufsliste')
	);
	const photo = $derived(avatarUrl(auth.user));
	const label = $derived(auth.user?.name || auth.user?.email?.split('@')[0] || '');
	const initial = $derived((label || '?').charAt(0).toUpperCase());

	// Haushaltsname oben und der Knopf zur Auswahl unten nur, wenn es mehr als
	// einen gibt -- sonst gibt es nichts zu waehlen.
	const current = $derived(activeHousehold());
	const several = $derived(households.list.length > 1);
</script>

<header class="safe-t bg-background/95 sticky top-0 z-20 border-b backdrop-blur">
	<div class="flex h-14 items-center gap-1 px-2">
		<Sheet.Root bind:open>
			<Sheet.Trigger>
				{#snippet child({ props })}
					<Button {...props} variant="ghost" size="icon-lg" class="size-11" aria-label="Menü öffnen">
						<MenuIcon class="size-5" />
					</Button>
				{/snippet}
			</Sheet.Trigger>

			<!-- Sheet bringt Fokusfalle, Escape, Scrim und aria-modal mit. -->
			<Sheet.Content side="left" class="gap-0">
				<Sheet.Header class="gap-0 border-b p-4 pr-12">
					<div class="flex items-center gap-3">
						<Avatar.Root size="lg">
							{#if photo}
								<Avatar.Image src={photo} alt="" />
							{/if}
							<Avatar.Fallback>{initial}</Avatar.Fallback>
						</Avatar.Root>
						<div class="min-w-0">
							<Sheet.Title class="truncate text-sm">{label || 'Ohne Namen'}</Sheet.Title>
							<Sheet.Description class="truncate text-xs">
								{auth.user?.email ?? ''}
							</Sheet.Description>
						</div>
					</div>
				</Sheet.Header>


				<nav class="flex flex-1 flex-col gap-1 p-2">
					{#each LINKS as link (link.href)}
						{@const active = page.url.pathname === link.href}
						<Button
							href={link.href}
							variant={active ? 'secondary' : 'ghost'}
							size="lg"
							class="h-auto min-h-11 justify-start py-2 text-left leading-tight whitespace-normal"
							aria-current={active ? 'page' : undefined}
						>
							<link.icon class="size-4" />
							{link.label}
						</Button>
					{/each}
				</nav>

				<div class="safe-b p-2">
					<Separator class="mb-2" />
					{#if several}
						{@const active = page.url.pathname === '/haushalte'}
						<Button
							href="/haushalte"
							variant={active ? 'secondary' : 'ghost'}
							size="lg"
							class="mb-1 h-auto min-h-11 w-full justify-start py-2 text-left leading-tight whitespace-normal"
							aria-current={active ? 'page' : undefined}
						>
							<HouseIcon class="size-4 shrink-0" />
							<span class="flex min-w-0 flex-1 flex-col">
								<span class="truncate">{current?.name ?? 'Haushalt'}</span>
								<span class="text-muted-foreground text-xs">Haushalt wechseln</span>
							</span>
						</Button>
					{/if}
					<Button
						variant="ghost"
						size="lg"
						class="text-destructive hover:text-destructive h-11 w-full justify-start"
						onclick={logout}
					>
						<LogOutIcon class="size-4" />
						Abmelden
					</Button>
				</div>
			</Sheet.Content>
		</Sheet.Root>

		<div class="min-w-0 flex-1">
			<h1 class="truncate text-base font-semibold">{title}</h1>
			{#if several && current}
				<p class="text-muted-foreground flex items-center gap-1.5 truncate text-xs">
					{current.name}
					{#if current.role === 'gast'}
						<Badge variant="outline" class="h-4 px-1 text-[10px]">Gast</Badge>
					{/if}
				</p>
			{/if}
		</div>

		<!-- Osterei: fuenf Tipps aufs Profilbild und der Drache fliegt. Das Bild ist
		     Dekoration (alt=""), der Knopf darum bleibt es deshalb auch: mit
		     `aria-hidden` und `tabindex="-1"` steht hier kein namenloses
		     Bedienelement in der Tastatur- und Screenreader-Reihenfolge. -->
		<button
			type="button"
			class="touch-manipulation rounded-full"
			onclick={tapAvatar}
			aria-hidden="true"
			tabindex="-1"
		>
			<Avatar.Root>
				{#if photo}
					<Avatar.Image src={photo} alt="" />
				{/if}
				<Avatar.Fallback class="text-xs">{initial}</Avatar.Fallback>
			</Avatar.Root>
		</button>
	</div>
</header>
