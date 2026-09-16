import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5311, strictPort: true },
  build: { target: 'es2022', rollupOptions: { input: ['index.html', 'electronics.html', 'rc.html', 'lamp.html', 'motor.html', 'controls.html', 'sensors.html', 'fan.html', 'bench.html'] } },
  // @dimforge/rapier3d-compat embeds its WASM as base64, so no .wasm asset needs
  // to be served and no top-level-await plugin is required.
  optimizeDeps: { exclude: [] },
});
