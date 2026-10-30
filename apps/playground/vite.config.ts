import { defineConfig, normalizePath } from 'vite';
import { resolve } from 'node:path';
import { threeDPlugin } from './server/three-d.mjs';
const jobsRoot=resolve(process.env.SETTLEMENT_3D_JOBS_ROOT??resolve(import.meta.dirname,'../../artifacts/web-3d'));
export default defineConfig({
  plugins:[threeDPlugin()],
  server:{fs:{deny:[
    // Preserve Vite's default private-file rules and keep backend artifacts
    // out of its direct filesystem routes. The 3D API serves approved images.
    '.env','.env.*','*.{crt,pem,key,p12,pfx,cer,der}',
    '.npmrc','.yarnrc.yml','**/.git/**',
    '**/*.blend*','**/artifacts/**',`${normalizePath(jobsRoot)}/**`,
  ]}},
  build:{rollupOptions:{input:{main:resolve(import.meta.dirname,'index.html'),compare:resolve(import.meta.dirname,'compare.html')}}},
});
