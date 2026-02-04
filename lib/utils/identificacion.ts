export const NIT_REQUIRED_DIGITS = 9;

export function normalizeDigits(value?: string | null) {
  return (value ?? "").replace(/\D/g, "");
}

export function getDigitCount(value?: string | null) {
  return normalizeDigits(value).length;
}

export function isNitIdentification(value?: string | null) {
  return (value ?? "").trim().toLowerCase() === "nit";
}
