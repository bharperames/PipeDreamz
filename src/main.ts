import { App } from './app/App';
import { loadSheets } from './render2d/sheet';
import { debugSprites } from './render2d/debugSheet';

async function boot(): Promise<void> {
  // Bitmap sprite sheets are optional: on failure the renderer falls back
  // to fully procedural sprites.
  await loadSheets(import.meta.env.BASE_URL);
  if (new URLSearchParams(location.search).has('sprites')) {
    debugSprites(document.getElementById('game') as HTMLCanvasElement);
    return;
  }
  new App();
}

void boot();
