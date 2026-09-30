import { createServer, preview } from 'vite';
import path from 'node:path';
export default async function setup() {
  const root = path.resolve('apps/playground');
  const dev = await createServer({ root, server: { host: '127.0.0.1', port: 5175, strictPort: true } }); await dev.listen();
  try {
    const prod = await preview({ root, preview: { host: '127.0.0.1', port: 4175, strictPort: true } });
    return async () => { await dev.close(); await new Promise<void>((resolve, reject) => prod.httpServer.close(e => e ? reject(e) : resolve())); };
  } catch (e) { await dev.close(); throw e; }
}
