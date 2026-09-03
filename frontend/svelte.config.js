import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter({
			fallback: 'index.html',
			pages: '../pb/pb_public',
			assets: '../pb/pb_public'
		})
	}
};

export default config;
