import { createServer, preview } from 'vite';
import path from 'node:path';

// Keep servers in-process so Windows does not need to kill npm shell trees.
export default async function setup() {
  const root = path.resolve('apps/openfl-probe');
  const dev = await createServer({ root, server: { host: '127.0.0.1', port: 5173, strictPort: true } });
  await dev.listen();
  try {
    const prod = await preview({ root, preview: { host: '127.0.0.1', port: 4173, strictPort: true } });
    return async () => {
      await dev.close();
      await new Promise<void>((resolve, reject) => prod.httpServer.close(error => error ? reject(error) : resolve()));
    };
  } catch (error) {
    await dev.close();
    throw error;
  }
}
