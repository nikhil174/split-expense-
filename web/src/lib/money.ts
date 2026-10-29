// Integer-paise helpers. Mirrors src/money.js on the server: at most two
// decimals, no signs, exponents or hex.
const AMOUNT_RE = /^(\d{1,10})(?:\.(\d{1,2}))?$/;

export function toCents(text: string): number | null {
  const m = AMOUNT_RE.exec(String(text).trim());
  return m ? Number(m[1]) * 100 + Number((m[2] || "").padEnd(2, "0")) : null;
}

export function inr(cents: number): string {
  return (cents < 0 ? "−" : "") + "₹" + (Math.abs(cents) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export const centsToInput = (cents: number) => (cents / 100).toFixed(2);

export function shortDate(ts: number) {
  const d = new Date(ts);
  return { month: d.toLocaleDateString("en-IN", { month: "short" }), day: d.getDate(), full: d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) };
}
