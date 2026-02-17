const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_REGEX = /^[\p{L}\p{M}\s\-'\.]+$/u;
const DIGITS_ONLY_REGEX = /^\d+$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_REGEX.test(value.trim());
}

export function isValidPhone(value: string): boolean {
  const trimmed = value.trim();
  if (!DIGITS_ONLY_REGEX.test(trimmed)) return false;
  return trimmed.length >= 7 && trimmed.length <= 10;
}

export function isValidName(value: string): boolean {
  return NAME_REGEX.test(value.trim());
}

