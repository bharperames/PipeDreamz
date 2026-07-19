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
          req.url = '/PipeDreamz/dev.html?assets';
          next();
          return;
        }
        // The repo root's index.html is the committed BUILT site; dev
        // serves the source entry instead.
        if (req.url === '/PipeDreamz/' || req.url === '/PipeDreamz/index.html') {
          req.url = '/PipeDreamz/dev.html';
        }
        next();
      });
    },
  };
}

export default defineConfig(({ command }) => ({
  // Builds use relative paths so the committed site works from any Pages
  // path with zero repo configuration; dev keeps the /PipeDreamz/ prefix.
  base: command === 'build' ? './' : '/PipeDreamz/',
  plugins: [assetSheetAlias()],
  server: {
    port: 4000,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      input: 'dev.html',
    },
  },
}));
