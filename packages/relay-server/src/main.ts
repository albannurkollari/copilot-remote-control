import { pathToFileURL } from 'node:url';

import { startRelayServer } from './server.ts';

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const server = await startRelayServer();

  process.stdout.write(`Relay server listening on ${server.address}\n`);
}
