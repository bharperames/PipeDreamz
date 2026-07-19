import { defineConfig, type Plugin } from 'vite';

/** Dev alias: /PipeDreamz_assets -> the asset review gallery. */
function assetSheetAlias(): Plugin {
  return {
    name: 'pipedreamz-asset-alias',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        // /PipeDreamz without a trailing slash: redirect like Pages would.
        if (req.url === '/PipeDreamz') {
          res.statusCode = 301;
          res.setHeader('Location', '/PipeDreamz/');
          res.end();
          return;
        }
        if (req.url?.startsWith('/PipeDreamz_assets')) {
          req.url = '/PipeDreamz/?assets';
        }
        next();
      });
    },
  };
}

export default defineConfig({
  // GitHub Pages serves the site from /<repo>/ unless a custom domain is set.
  base: process.env.PIPEDREAMZ_BASE ?? '/PipeDreamz/',
  plugins: [assetSheetAlias()],
  server: {
    port: 4000,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
