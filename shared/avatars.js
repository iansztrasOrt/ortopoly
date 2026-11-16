// Fichas (emoji, sin imágenes con derechos de autor) y colores de jugador.
export const AVATARS = [
  { id: 'rocket', emoji: '🚀', label: 'Cohete' },
  { id: 'cat', emoji: '🐈', label: 'Gato' },
  { id: 'guitar', emoji: '🎸', label: 'Guitarra' },
  { id: 'mate', emoji: '🧉', label: 'Mate' },
  { id: 'bike', emoji: '🚲', label: 'Bici' },
  { id: 'umbrella', emoji: '☂️', label: 'Paraguas' },
  { id: 'dino', emoji: '🦖', label: 'Dino' },
  { id: 'kite', emoji: '🪁', label: 'Barrilete' },
];

export const COLORS = [
  { id: 'tomato', hex: '#e8553e', label: 'Tomate' },
  { id: 'ocean', hex: '#2f7fd1', label: 'Océano' },
  { id: 'sun', hex: '#e9a417', label: 'Sol' },
  { id: 'mint', hex: '#27a86b', label: 'Menta' },
  { id: 'grape', hex: '#8a55d6', label: 'Uva' },
  { id: 'rose', hex: '#e04f93', label: 'Rosa' },
  { id: 'teal', hex: '#13a3a8', label: 'Turquesa' },
  { id: 'coal', hex: '#5b6475', label: 'Carbón' },
];

export const AVATAR_IDS = AVATARS.map((a) => a.id);
export const COLOR_IDS = COLORS.map((c) => c.id);

export function avatarEmoji(id) {
  return (AVATARS.find((a) => a.id === id) || AVATARS[0]).emoji;
}

export function colorHex(id) {
  return (COLORS.find((c) => c.id === id) || COLORS[0]).hex;
}
