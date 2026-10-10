import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    // koffi is a native module and must load from node_modules at runtime.
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        // Sandboxed preloads must be CommonJS.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    build: {
      rollupOptions: {
        // popout.html: the blank page panels are moved into when popped out.
        // tutorial.html: the walkthrough video's own window.
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          popout: resolve(__dirname, 'src/renderer/popout.html'),
          tutorial: resolve(__dirname, 'src/renderer/tutorial.html'),
        },
      },
    },
  },
})
