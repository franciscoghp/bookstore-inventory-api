import { config } from './config';
import { createApp } from './app';

createApp().listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}`);
});
