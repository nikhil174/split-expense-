// Browser end-to-end test against a running Worker (local `wrangler dev`).
// Not part of `npm test`; run with `npm run test:e2e` after starting
// `npx wrangler dev --local` with ADMIN_PIN set in .dev.vars.
//   E2E_BASE_URL   default http://127.0.0.1:8787
//   E2E_ADMIN_PIN  must match the running Worker's ADMIN_PIN
//   E2E_SHOTS_DIR  optional directory for screenshots
// Never point this at production: it creates groups, members and payments.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// createRequire so a globally installed Playwright (NODE_PATH) also works.
const { chromium, devices } = createRequire(import.meta.url)("playwright");

const BASE = process.env.E2E_BASE_URL || "http://127.0.0.1:8787";
const PIN = process.env.E2E_ADMIN_PIN;
const SHOTS = process.env.E2E_SHOTS_DIR;
if (!PIN) throw new Error("Set E2E_ADMIN_PIN");
if (/workers\.dev|split-expense\./.test(BASE) && !process.env.E2E_ALLOW_REMOTE) throw new Error("Refusing to run write tests against a deployed Worker");

const GROUP = "E2E Trip " + Date.now().toString(36);
const browser = await chromium.launch();
const phone = { ...devices["Pixel 7"] };
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };
const notice = page => page.locator("#notice");
const step = name => console.log("✓", name);

async function newPage() {
  const context = await browser.newContext(phone);
  const page = await context.newPage();
  page.on("pageerror", e => { throw new Error("Page error: " + e.message); });
  await page.goto(BASE + "/");
  return page;
}
async function noHorizontalOverflow(page, label) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  assert.ok(sw <= cw, `${label}: page overflows horizontally (${sw} > ${cw})`);
}
async function adminLogin(page) {
  await page.click("#modeAdmin");
  await page.fill("#adminName", "E2E Admin");
  await page.fill("#pin", PIN);
  await page.click("#adminLogin button");
  await page.locator("#adminPanel").waitFor();
}
async function requestAccess(page, name) {
  await page.click("#tabRequest");
  await page.fill("#name", name);
  await page.selectOption("#requestGroup", { label: GROUP });
  await page.click("#requestForm button");
  await assert.doesNotReject(notice(page).filter({ hasText: "submitted" }).waitFor());
}
async function memberSignIn(page, name) {
  await page.goto(BASE + "/");
  await page.selectOption("#memberSigninGroup", { label: GROUP });
  await page.fill("#memberSigninName", name);
  await page.click("#memberLogin button");
  await page.locator("#groups .group").first().waitFor();
  assert.equal(await page.locator("#groups .group small").first().textContent(), "Open dashboard →");
  await page.locator("#groups .group", { hasText: GROUP }).click();
  await page.locator("#groupTitle", { hasText: GROUP }).waitFor();
  assert.ok(await page.locator("#groupsCard").isHidden(), "opening a group replaces the list view");
}
const text = async (page, sel) => (await page.locator(sel).innerText()).replace(/\s+/g, " ");

try {
  const admin = await newPage();
  await adminLogin(admin);
  await admin.fill("#adminGroupName", GROUP);
  await admin.click("#adminCreateGroup button");
  await notice(admin).filter({ hasText: "Group created" }).waitFor();
  step("admin signed in and created group");

  const bea = await newPage(), cy = await newPage();
  await requestAccess(bea, "Bea E2E");
  await requestAccess(cy, "Cy E2E");
  await admin.goto(BASE + "/");
  await adminLogin(admin);
  for (const name of ["Bea E2E", "Cy E2E"]) {
    await admin.locator("#requests .item", { hasText: name }).filter({ hasText: "pending" }).getByRole("button", { name: "Approve" }).click();
    await admin.locator("#requests .item", { hasText: name }).filter({ hasText: "approved" }).waitFor();
  }
  step("members requested access and admin approved them");

  await memberSignIn(bea, "Bea E2E");
  await noHorizontalOverflow(bea, "group page");
  assert.equal(await bea.inputValue("#paidBy"), await bea.locator("#paidBy option", { hasText: "(you)" }).getAttribute("value"), "payer defaults to me");
  await bea.fill("#desc", "Dinner");
  await bea.fill("#amount", "100");
  await bea.locator("#splitMembers label", { hasText: "E2E Admin" }).locator("input").uncheck();
  await bea.click("#saveExpense");
  await notice(bea).filter({ hasText: "Expense saved" }).waitFor();
  await bea.locator("#owedToYou", { hasText: "Cy E2E needs to pay you" }).waitFor();
  assert.match(await text(bea, "#owedToYou"), /Cy E2E needs to pay you ₹50\.00 Waiting for Cy E2E to record payment\./);
  assert.match(await text(bea, "#balances"), /Bea E2E \(you\) gets back ₹50\.00/);
  step("equal split: Bea paid ₹100 for Bea+Cy → Cy owes Bea ₹50");

  await bea.click("#splitManualMode");
  await bea.fill("#desc", "Snacks");
  await bea.fill("#amount", "10");
  const manual = bea.locator("#manualSplitMembers .manual-split-amount");
  await manual.nth(await bea.locator("#manualSplitMembers label").evaluateAll(ls => ls.findIndex(l => l.textContent.startsWith("Bea")))).fill("5.00");
  await manual.nth(await bea.locator("#manualSplitMembers label").evaluateAll(ls => ls.findIndex(l => l.textContent.startsWith("Cy")))).fill("4.99");
  assert.match(await text(bea, "#manualSplitTotal"), /Allocated: ₹9\.99 \/ ₹10\.00 · ₹0\.01 left/);
  await bea.click("#saveExpense");
  await notice(bea).filter({ hasText: "add up exactly" }).waitFor();
  await manual.nth(await bea.locator("#manualSplitMembers label").evaluateAll(ls => ls.findIndex(l => l.textContent.startsWith("Cy")))).fill("5.00");
  assert.match(await text(bea, "#manualSplitTotal"), /Allocated: ₹10\.00 \/ ₹10\.00 ✓/);
  await bea.click("#saveExpense");
  await notice(bea).filter({ hasText: "Expense saved" }).waitFor();
  await bea.locator("#owedToYou", { hasText: "₹55.00" }).waitFor();
  step("manual split: ₹5.00 + ₹4.99 for ₹10 rejected; ₹5 + ₹5 saved → Cy owes ₹55");
  await shot(bea, "bea-group");

  await memberSignIn(cy, "Cy E2E");
  assert.match(await text(cy, "#youOwe"), /You need to pay Bea E2E ₹55\.00/);
  assert.match(await text(cy, "#myDebtSummary"), /You owe in total ₹55\.00 You are owed in total ₹0\.00/);
  assert.equal(await cy.locator("#settleDebt option").count(), 1, "Cy can only record her own payment");
  await cy.getByRole("button", { name: "Pay / settle" }).click();
  await cy.fill("#settleAmount", "60");
  assert.equal(await cy.$eval("#settleAmount", e => e.validity.rangeOverflow), true, "browser blocks paying more than owed");
  await cy.click("#recordPayment");
  assert.equal(await cy.locator("#settlementHistory .item").count(), 0);
  await cy.fill("#settleAmount", "20");
  await cy.click("#recordPayment");
  await notice(cy).filter({ hasText: "Payment of ₹20.00 from Cy E2E to Bea E2E recorded" }).waitFor();
  await cy.locator("#youOwe", { hasText: "₹35.00" }).waitFor();
  assert.match(await text(cy, "#settlementHistory"), /Cy E2E paid Bea E2E ₹20\.00/);
  step("partial repayment ₹20 → Cy now owes ₹35; overpayment blocked");

  await cy.getByRole("button", { name: "Pay / settle" }).click();
  await cy.click("#settleFull");
  assert.equal(await cy.inputValue("#settleAmount"), "35.00");
  await cy.click("#recordPayment");
  await cy.locator("#youOwe", { hasText: "You don’t owe anyone" }).waitFor();
  assert.ok(await cy.locator("#settlementForm").isHidden());
  assert.match(await text(cy, "#balances"), /Cy E2E \(you\) ₹0\.00 · settled/);
  assert.match(await text(cy, "#whoOwesWhom"), /Everyone is settled up/);
  step("settle full amount fills ₹35.00 exactly and clears the debt");
  await shot(cy, "cy-settled");
  await noHorizontalOverflow(cy, "settled page");

  await bea.reload();
  await memberSignIn(bea, "Bea E2E");
  assert.match(await text(bea, "#owedToYou"), /Nobody owes you/);
  assert.equal(await bea.locator("#settlementHistory .item").count(), 2);
  await bea.click("#backToGroups");
  assert.ok(await bea.locator("#groupsCard").isVisible() && await bea.locator("#groupPanel").isHidden());
  step("creditor view refreshed; back to groups restores the list");
  console.log("E2E PASSED");
} finally {
  await browser.close();
}
