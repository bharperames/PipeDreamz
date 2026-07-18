/** Keyboard bindings (event.code, layout-independent). */
export interface PlayerKeys {
  up: string[];
  down: string[];
  left: string[];
  right: string[];
  place: string[];
}

export const P1_KEYS: PlayerKeys = {
  up: ['ArrowUp'],
  down: ['ArrowDown'],
  left: ['ArrowLeft'],
  right: ['ArrowRight'],
  place: ['Space', 'Enter'],
};

export const P2_KEYS: PlayerKeys = {
  up: ['KeyW'],
  down: ['KeyS'],
  left: ['KeyA'],
  right: ['KeyD'],
  place: ['KeyQ', 'Tab'],
};

export const KEY_FAST = ['KeyF'];
export const KEY_PAUSE = ['KeyP'];
export const KEY_QUIT = ['Escape'];
/** Expert mode: hold to place from the top dispenser. */
export const KEY_ALT_DISPENSER = ['ShiftLeft', 'ShiftRight'];
