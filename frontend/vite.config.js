import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: {
		proxy: {
			// PocketBase laeuft lokal auf 8090 -> kein CORS im Dev-Modus,
			// gleiche Origin wie spaeter in Produktion.
			'/api': { target: 'http://127.0.0.1:8090', changeOrigin: true, ws: true },
			'/_': { target: 'http://127.0.0.1:8090', changeOrigin: true }
		}
	}
});
