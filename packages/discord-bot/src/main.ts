import { pathToFileURL } from 'node:url';

import { createDiscordBot, loadDiscordBotConfig } from './bot.ts';

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const bot = createDiscordBot(loadDiscordBotConfig());
  await bot.start();
}
