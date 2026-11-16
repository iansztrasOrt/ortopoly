// Mazos de cartas. Los textos (con tono divertido y nombres del tema) están en
// /public/js/i18n; aquí solo vive la mecánica exacta de cada carta.
//   chance    = mazo "Fortuna"
//   community = mazo "Vecindario"

import { shuffle } from './rng.js';

export const CHANCE_CARDS = Object.freeze([
  { id: 'c_go', action: 'moveTo', target: 0 },
  { id: 'c_red3', action: 'moveTo', target: 24 },
  { id: 'c_pink1', action: 'moveTo', target: 11 },
  { id: 'c_utility', action: 'nearestUtility' },
  { id: 'c_rail_a', action: 'nearestRailroad' },
  { id: 'c_rail_b', action: 'nearestRailroad' },
  { id: 'c_dividend', action: 'collect', amount: 50 },
  { id: 'c_jailfree', action: 'jailFree' },
  { id: 'c_back3', action: 'moveBy', steps: -3 },
  { id: 'c_gotojail', action: 'goToJail' },
  { id: 'c_repairs', action: 'repairs', house: 25, hotel: 100 },
  { id: 'c_poor_tax', action: 'pay', amount: 15 },
  { id: 'c_rail_first', action: 'moveTo', target: 5 },
  { id: 'c_blue2', action: 'moveTo', target: 39 },
  { id: 'c_chairman', action: 'payEach', amount: 50 },
  { id: 'c_loan', action: 'collect', amount: 150 },
]);

export const COMMUNITY_CARDS = Object.freeze([
  { id: 'k_go', action: 'moveTo', target: 0 },
  { id: 'k_bank_error', action: 'collect', amount: 200 },
  { id: 'k_doctor', action: 'pay', amount: 50 },
  { id: 'k_stock', action: 'collect', amount: 50 },
  { id: 'k_jailfree', action: 'jailFree' },
  { id: 'k_gotojail', action: 'goToJail' },
  { id: 'k_holiday', action: 'collect', amount: 100 },
  { id: 'k_tax_refund', action: 'collect', amount: 20 },
  { id: 'k_birthday', action: 'collectEach', amount: 10 },
  { id: 'k_life_insurance', action: 'collect', amount: 100 },
  { id: 'k_hospital', action: 'pay', amount: 100 },
  { id: 'k_school', action: 'pay', amount: 50 },
  { id: 'k_consulting', action: 'collect', amount: 25 },
  { id: 'k_street_repairs', action: 'repairs', house: 40, hotel: 115 },
  { id: 'k_beauty', action: 'collect', amount: 10 },
  { id: 'k_inherit', action: 'collect', amount: 100 },
]);

export const JAIL_FREE_CARD = Object.freeze({ chance: 'c_jailfree', community: 'k_jailfree' });

const BY_ID = new Map([...CHANCE_CARDS, ...COMMUNITY_CARDS].map((c) => [c.id, c]));

export function cardById(id) {
  return BY_ID.get(id);
}

export function buildDeck(deck, rng) {
  const cards = deck === 'chance' ? CHANCE_CARDS : COMMUNITY_CARDS;
  return shuffle(cards.map((c) => c.id), rng);
}
