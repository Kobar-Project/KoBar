import { build } from 'vite';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runBuild() {
  await build({
    root: __dirname,
    build: {
      lib: {
        entry: path.resolve(__dirname, 'index.jsx'),
        name: 'KoCalendarPlugin',
        formats: ['iife'],
        fileName: () => 'index.js'
      },
      outDir: __dirname,
      emptyOutDir: false,
      minify: false,
      rollupOptions: {
        external: ['react', 'react-dom'],
        output: { globals: { react: 'window.React', 'react-dom': 'window.ReactDOM' } }
      }
    },
    esbuild: { jsxFactory: 'window.React.createElement', jsxFragment: 'window.React.Fragment' }
  });
  console.log("Build complete: index.js generated.");
}
runBuild();
