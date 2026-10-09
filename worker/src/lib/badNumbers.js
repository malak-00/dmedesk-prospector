// A phone number a rep found to be wrong (sql/038). Pure checks, so they are tested without a database.

export const REASONS = ["wrong", "disconnected"];

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// The 10-digit national form of any way a number is written: "(404) 808-5118", "+1 404-808-5118", "404.808.5118".
export function nationalNumber(raw) {
  const digits = String(raw ?? "").replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return /^\d{10}$/.test(national) ? national : "";
}

export function prettyNumber(national) {
  return `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`;
}

export function cleanFlag(input = {}) {
  const npi = String(input.npi ?? "").trim();
  if (!/^\d{10}$/.test(npi)) throw httpError(400, "A 10-digit NPI is required");
  const number = nationalNumber(input.number);
  if (!number) throw httpError(400, "That doesn't look like a 10-digit phone number");
  const reason = String(input.reason ?? "wrong").trim().toLowerCase();
  if (!REASONS.includes(reason)) throw httpError(400, "Choose wrong number or not in service");
  return { npi, number, reason };
}

export function cleanNpiList(raw, max = 200) {
  const list = String(raw ?? "").split(",").map((s) => s.trim()).filter((s) => /^\d{10}$/.test(s));
  return [...new Set(list)].slice(0, max);
}
