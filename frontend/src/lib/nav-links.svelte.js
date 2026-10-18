import ShoppingCartIcon from '@lucide/svelte/icons/shopping-cart';
import CarIcon from '@lucide/svelte/icons/car';
import LightbulbIcon from '@lucide/svelte/icons/lightbulb';
import EuroIcon from '@lucide/svelte/icons/euro';
import GiftIcon from '@lucide/svelte/icons/gift';
import PartyPopperIcon from '@lucide/svelte/icons/party-popper';
import DumbbellIcon from '@lucide/svelte/icons/dumbbell';
import UsersIcon from '@lucide/svelte/icons/users';
import UserIcon from '@lucide/svelte/icons/user';
import { auth } from './pocketbase.svelte.js';
import { carName } from './households.svelte.js';

/** So viele Seiten passen in die Schnellleiste unten. */
export const QUICK_MAX = 3;
/** Auswahl, solange jemand die Schnellleiste nie eingestellt hat (`quick_nav = null`). */
export const QUICK_DEFAULT = ['/', '/ausgaben'];

/**
 * Die Seiten des Menues. `label` steht im Menue, `title` in der Topbar --
 * die Startseite heisst dort nach ihrem Inhalt, oben aber weiter nach der
 * App; die Schnellleiste zeigt dieselben `label` wie das Menue. Das Auto heisst in
 * jedem Haushalt anders (`households.car_name`), "Training" steht nur drin,
 * wer es im Profil eingeschaltet hat (`users.show_training`).
 *
 * Liest `auth` und den aktiven Haushalt, ist also aus einem `$derived`
 * heraus reaktiv.
 */
export function navLinks() {
	const car = carName();
	const showTraining = Boolean(auth.user?.show_training);
	return [
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
		{
			href: '/zusammen',
			label: 'Müssen wir mal machen',
			title: 'Müssen wir mal machen',
			icon: PartyPopperIcon
		},
		...(showTraining
			? [{ href: '/training', label: 'Training', title: 'Training', icon: DumbbellIcon }]
			: []),
		{ href: '/residents', label: 'Bewohner', title: 'Bewohner', icon: UsersIcon },
		{ href: '/profile', label: 'Profil', title: 'Profil', icon: UserIcon }
	];
}

/**
 * Gewaehlte Pfade der Schnellleiste (`users.quick_nav`, Migration
 * 1789995600). `null` = nie eingestellt -> Vorgabe. Was nicht (mehr) im Menue
 * steht -- etwa "Training" nach dem Ausschalten --, faellt still heraus.
 */
export function quickPaths() {
	const raw = auth.user?.quick_nav;
	const chosen = Array.isArray(raw) ? raw : QUICK_DEFAULT;
	return chosen.filter((p) => typeof p === 'string');
}

/** Die Links der Schnellleiste, in Menue-Reihenfolge und hoechstens `QUICK_MAX`. */
export function quickLinks() {
	const chosen = quickPaths();
	return navLinks()
		.filter((l) => chosen.includes(l.href))
		.slice(0, QUICK_MAX);
}
