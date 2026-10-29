import test from "node:test";
import assert from "node:assert/strict";
import { parseAmountToCents, MAX_AMOUNT_CENTS } from "../src/money.js";

test("parses rupee amounts into exact integer paise", () => {
  const cases = [["10", 1000], ["10.5", 1050], ["10.50", 1050], ["0.01", 1], [" 7 ", 700], [1000, 100000],
    [0.29, 29], [0.1, 10], [10.1, 1010], [1.15, 115], [4.99, 499], ["999.99", 99999]];
  for (const [input, cents] of cases) assert.equal(parseAmountToCents(input), cents, JSON.stringify(input));
});

test("rejects values that could become NaN, fractional paise or non-amounts", () => {
  const bad = ["", "  ", "abc", "10.005", "1e3", "0x10", "-1", "+5", "1,000", "Infinity", "NaN", ".5", "5.",
    -1, 10.005, 1e-7, NaN, Infinity, true, false, null, undefined, [5], { amount: 5 }];
  for (const input of bad) assert.throws(() => parseAmountToCents(input), TypeError, JSON.stringify(input));
});

test("zero is rejected unless explicitly allowed (manual split rows)", () => {
  assert.throws(() => parseAmountToCents("0"), /greater than zero/);
  assert.throws(() => parseAmountToCents(0), /greater than zero/);
  assert.equal(parseAmountToCents("0", { allowZero: true }), 0);
  assert.equal(parseAmountToCents("0.00", { allowZero: true }), 0);
});

test("rejects amounts above the safe maximum", () => {
  assert.equal(parseAmountToCents(String(MAX_AMOUNT_CENTS / 100)), MAX_AMOUNT_CENTS);
  assert.throws(() => parseAmountToCents(String(MAX_AMOUNT_CENTS / 100) + ".01"), /too large/);
  assert.throws(() => parseAmountToCents("99999999999999999999"), TypeError);
});

test("every two-decimal string from 0.01 to 20.00 round-trips exactly", () => {
  for (let cents = 1; cents <= 2000; cents++) {
    const text = (cents / 100).toFixed(2);
    assert.equal(parseAmountToCents(text), cents, text);
    assert.equal(parseAmountToCents(Number(text)), cents, "number " + text);
  }
});
