import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Klassen zusammenfuehren; spaetere Tailwind-Utilities gewinnen. */
export function cn(...inputs) {
	return twMerge(clsx(inputs));
}
