// Sanitización de texto de usuarios (nombres y chat). El cliente además
// renderiza siempre con textContent, nunca con innerHTML.

const CONTROL = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g;
const ANGLE = /[<>]/g;

export function cleanText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFC')
    .replace(CONTROL, '')
    .replace(ANGLE, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function cleanName(value) {
  const name = cleanText(value, 20);
  return name.length >= 1 ? name : null;
}

export function cleanChat(value) {
  const text = cleanText(value, 240);
  return text.length ? text : null;
}

export const REACTIONS = ['👏', '😂', '😱', '😡', '🤑', '🙏', '🔥', '💸'];

export function cleanCode(value) {
  if (typeof value !== 'string') return null;
  const code = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return code.length >= 5 && code.length <= 6 ? code : null;
}
