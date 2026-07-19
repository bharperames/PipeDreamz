import { App } from './app/App';
import { loadSheets } from './render2d/sheet';
import { debugSprites } from './render2d/debugSheet';
import { assetGallery } from './render2d/assetGallery';

async function boot(): Promise<void> {
  // Bitmap sprite sheets are optional: on failure the renderer falls back
  // to fully procedural sprites.
  await loadSheets(import.meta.env.BASE_URL);
  const params = new URLSearchParams(location.search);
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  if (params.has('assets') || location.pathname.includes('PipeDreamz_assets')) {
    assetGallery(canvas);
    return;
  }
  if (params.has('sprites')) {
    debugSprites(canvas);
    return;
  }
  new App();
}

void boot();
