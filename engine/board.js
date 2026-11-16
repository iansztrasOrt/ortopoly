// Datos del tablero (40 casillas, posiciones 0-39).
// Módulo puro: lo usan el servidor, los tests y el navegador.
// Los NOMBRES de las casillas viven en /shared/themes (temas intercambiables);
// aquí solo hay datos de reglas.

export const BOARD_SIZE = 40;
export const GO_POS = 0;
export const JAIL_POS = 10;
export const FREE_PARKING_POS = 20;
export const GO_TO_JAIL_POS = 30;
export const GO_SALARY = 200;
export const JAIL_FINE = 50;
export const MAX_JAIL_TURNS = 3;
export const DEFAULT_HOUSES = 32;
export const DEFAULT_HOTELS = 12;
export const HOTEL_LEVEL = 5; // nivel 1-4 = casas, 5 = hotel
export const RAILROAD_RENT = [0, 25, 50, 100, 200];
export const UTILITY_MULTIPLIER = [0, 4, 10];

const street = (pos, group, price, rent, houseCost, mortgage) => ({
  pos, type: 'street', group, price, rent, houseCost, mortgage,
});
const railroad = (pos) => ({ pos, type: 'railroad', group: 'railroad', price: 200, mortgage: 100 });
const utility = (pos) => ({ pos, type: 'utility', group: 'utility', price: 150, mortgage: 75 });

export const SPACES = Object.freeze([
  { pos: 0, type: 'go' },
  street(1, 'brown', 60, [2, 10, 30, 90, 160, 250], 50, 30),
  { pos: 2, type: 'community' },
  street(3, 'brown', 60, [4, 20, 60, 180, 320, 450], 50, 30),
  { pos: 4, type: 'tax', amount: 200 },
  railroad(5),
  street(6, 'lightblue', 100, [6, 30, 90, 270, 400, 550], 50, 50),
  { pos: 7, type: 'chance' },
  street(8, 'lightblue', 100, [6, 30, 90, 270, 400, 550], 50, 50),
  street(9, 'lightblue', 120, [8, 40, 100, 300, 450, 600], 50, 60),
  { pos: 10, type: 'jail' },
  street(11, 'pink', 140, [10, 50, 150, 450, 625, 750], 100, 70),
  utility(12),
  street(13, 'pink', 140, [10, 50, 150, 450, 625, 750], 100, 70),
  street(14, 'pink', 160, [12, 60, 180, 500, 700, 900], 100, 80),
  railroad(15),
  street(16, 'orange', 180, [14, 70, 200, 550, 750, 950], 100, 90),
  { pos: 17, type: 'community' },
  street(18, 'orange', 180, [14, 70, 200, 550, 750, 950], 100, 90),
  street(19, 'orange', 200, [16, 80, 220, 600, 800, 1000], 100, 100),
  { pos: 20, type: 'parking' },
  street(21, 'red', 220, [18, 90, 250, 700, 875, 1050], 150, 110),
  { pos: 22, type: 'chance' },
  street(23, 'red', 220, [18, 90, 250, 700, 875, 1050], 150, 110),
  street(24, 'red', 240, [20, 100, 300, 750, 925, 1100], 150, 120),
  railroad(25),
  street(26, 'yellow', 260, [22, 110, 330, 800, 975, 1150], 150, 130),
  street(27, 'yellow', 260, [22, 110, 330, 800, 975, 1150], 150, 130),
  utility(28),
  street(29, 'yellow', 280, [24, 120, 360, 850, 1025, 1200], 150, 140),
  { pos: 30, type: 'gotojail' },
  street(31, 'green', 300, [26, 130, 390, 900, 1100, 1275], 200, 150),
  street(32, 'green', 300, [26, 130, 390, 900, 1100, 1275], 200, 150),
  { pos: 33, type: 'community' },
  street(34, 'green', 320, [28, 150, 450, 1000, 1200, 1400], 200, 160),
  railroad(35),
  { pos: 36, type: 'chance' },
  street(37, 'darkblue', 350, [35, 175, 500, 1100, 1300, 1500], 200, 175),
  { pos: 38, type: 'tax', amount: 100 },
  street(39, 'darkblue', 400, [50, 200, 600, 1400, 1700, 2000], 200, 200),
]);

export const GROUP_ORDER = ['brown', 'lightblue', 'pink', 'orange', 'red', 'yellow', 'green', 'darkblue', 'railroad', 'utility'];
export const STREET_GROUPS = GROUP_ORDER.slice(0, 8);

export const GROUPS = Object.freeze(
  Object.fromEntries(GROUP_ORDER.map((g) => [g, SPACES.filter((s) => s.group === g).map((s) => s.pos)])),
);

export const OWNABLE = Object.freeze(SPACES.filter((s) => s.price).map((s) => s.pos));
export const RAILROADS = GROUPS.railroad;
export const UTILITIES = GROUPS.utility;

export function space(pos) {
  return SPACES[pos];
}

export function isOwnable(pos) {
  return Boolean(SPACES[pos] && SPACES[pos].price);
}

export function isStreet(pos) {
  return SPACES[pos]?.type === 'street';
}

export function groupMembers(group) {
  return GROUPS[group] || [];
}

/** Primera casilla de la lista que esté estrictamente por delante (con vuelta). */
export function nextOfType(fromPos, list) {
  const sorted = [...list].sort((a, b) => a - b);
  return sorted.find((p) => p > fromPos) ?? sorted[0];
}

export function unmortgageCost(pos) {
  return Math.ceil((SPACES[pos].mortgage * 11) / 10);
}

export function mortgageInterest(pos) {
  return Math.ceil(SPACES[pos].mortgage / 10);
}

/** Pasos hacia adelante desde `from` hasta `to` (0..39). */
export function forwardDistance(from, to) {
  return (((to - from) % BOARD_SIZE) + BOARD_SIZE) % BOARD_SIZE;
}
