import { defineConfig } from 'vite';

/**
 * THE ELECTRONICS BENCH DEV SERVER — its own port, its own root URL.
 *
 * Port 5312. NOT 5177, which belongs to a different project entirely and is never
 * touched. 5311 stays the mechanics/demo page. The two are the same codebase and
 * the same verified SimWorld; only the page differs, so a circuit fix cannot drift
 * away from the physics that was actually tested.
 *
 * `/` serves the bench so the URL is just the port, with no path to remember.
 */
export default defineConfig({
  server: {
    port: 5312,
    strictPort: true,
    open: false,
  },
  build: { target: 'es2022' },
  plugins: [{
    name: 'bench-at-root',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        // THE ROOT SERVES THE CAPACITOR, because that is where the work is.
        //
        // It used to serve the DC bench, which opens on a voltage divider with no
        // capacitor in it — so opening "the electronics bench" showed none of the
        // capacitor work, which lived on /rc.html and was never signposted. Peter
        // hit exactly that and was right to be annoyed. The bench is still one
        // click away from the capacitor page.
        if (req.url === '/' || req.url === '/index.html') req.url = '/rc.html';
        next();
      });
    },
  }],
});
