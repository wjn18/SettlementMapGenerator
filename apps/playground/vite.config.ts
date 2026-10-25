import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { threeDPlugin } from './server/three-d.mjs';
export default defineConfig({plugins:[threeDPlugin()],build:{rollupOptions:{input:{main:resolve(import.meta.dirname,'index.html'),compare:resolve(import.meta.dirname,'compare.html')}}}});
