import puerto from './puerto.js';
import buenosAires from './buenos-aires.js';

// Para agregar un tema: crear un archivo como puerto.js y sumarlo acá.
export const THEMES = { [puerto.id]: puerto, [buenosAires.id]: buenosAires };
export const DEFAULT_THEME = puerto.id;

export function getTheme(id) {
  return THEMES[id] || THEMES[DEFAULT_THEME];
}
