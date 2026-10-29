// Money helpers. All arithmetic is done in integer paise; rupees only exist as
// user input (string or number) and as display output.

export const MAX_AMOUNT_CENTS = 10_000_000_000; // ₹10,00,00,000

const AMOUNT_PATTERN = /^(\d{1,10})(?:\.(\d{1,2}))?$/;

// Parse a rupee amount into integer paise without floating-point math.
// Accepts a non-negative number or a plain decimal string with at most two
// decimal places ("10", "10.5", "10.50"). Rejects exponents, hex, signs,
// booleans, arrays, fractional paise ("10.005") and anything non-finite.
export function parseAmountToCents(value, { allowZero = false, max = MAX_AMOUNT_CENTS } = {}) {
  let text;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Enter a valid amount.");
    text = String(value);
  } else if (typeof value === "string") {
    text = value.trim();
  } else {
    throw new TypeError("Enter a valid amount.");
  }
  const match = AMOUNT_PATTERN.exec(text);
  if (!match) throw new TypeError("Enter an amount in rupees with at most two decimal places.");
  const cents = Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) throw new TypeError("Amount is too large.");
  if (cents === 0 && !allowZero) throw new TypeError("Amount must be greater than zero.");
  if (cents > max) throw new TypeError("Amount is too large.");
  return cents;
}
