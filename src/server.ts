import { requireEnv } from './config';
import { createApp } from './app';

const port = Number(requireEnv('PORT'));

createApp().listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
