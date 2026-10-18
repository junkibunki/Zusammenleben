<script>
	import { page } from '$app/state';
	import { quickLinks } from '$lib/nav-links.svelte.js';

	// Schnellleiste unten: bis zu drei Seiten, im Profil gewaehlt. Das Menue
	// oben bleibt die vollstaendige Navigation. `sticky` statt `fixed`: die
	// Leiste nimmt im Fluss Platz ein, keine Seite muss unten Raum freihalten.
	// Die Satzpause des Trainings liegt `fixed` mit z-30 darueber. `mt-auto`
	// drueckt sie auf kurzen Seiten nach unten. Die untere Safe-Area gehoert
	// hierher, auch ohne Leiste (der Rahmen in +layout.svelte hat keine mehr).
	const links = $derived(quickLinks());

	// Unterseiten zaehlen mit (/training/kalender -> Training); die Startseite
	// nur exakt, sonst waere sie immer aktiv.
	function isActive(href) {
		const path = page.url.pathname;
		return path === href || (href !== '/' && path.startsWith(href + '/'));
	}
</script>

{#if links.length > 0}
	<nav
		aria-label="Schnellzugriff"
		class="safe-b bg-background/95 sticky bottom-0 z-20 mt-auto border-t backdrop-blur [view-transition-name:bottombar]"
	>
		<ul class="flex">
			{#each links as link (link.href)}
				{@const active = isActive(link.href)}
				<li class="min-w-0 flex-1">
					<a
						href={link.href}
						class="flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 py-1 text-xs transition-colors {active
							? 'text-primary font-medium'
							: 'text-muted-foreground hover:text-foreground'}"
						aria-current={active ? 'page' : undefined}
					>
						<link.icon class="size-5" />
						<span class="line-clamp-2 max-w-full text-center leading-tight">{link.label}</span>
					</a>
				</li>
			{/each}
		</ul>
	</nav>
{:else}
	<div class="safe-b"></div>
{/if}
