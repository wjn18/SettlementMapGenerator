import { parentPort } from 'node:worker_threads';
import { generateTown } from '@settlement/core';
parentPort.on('message', options => parentPort.postMessage(generateTown(options)));
