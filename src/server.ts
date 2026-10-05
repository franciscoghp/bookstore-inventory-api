import { config } from './config';
import { createApp } from './app';

createApp().listen(config.port, () => {
  console.log(`API escuchando en http://localhost:${config.port}`);
});
