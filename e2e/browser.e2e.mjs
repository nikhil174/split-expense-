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
  assert.equal(await page.locator("#groups .group .open-hint").first().textContent(), "Open dashboard →");
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
  assert.match(await text(bea, "#expenseEmpty"), /No expenses yet/);
  await bea.click("#openAddExpense");
  assert.equal(await bea.inputValue("#paidBy"), await bea.locator("#paidBy option", { hasText: "(you)" }).getAttribute("value"), "payer defaults to me");
  await bea.fill("#desc", "Dinner");
  await bea.fill("#amount", "100");
  await bea.locator("#splitMembers label", { hasText: "E2E Admin" }).locator("input").uncheck();
  assert.match(await text(bea, "#equalPreview"), /₹50\.00 per person · 2 people/);
  await bea.click("#saveExpense");
  await notice(bea).filter({ hasText: "Dinner” saved" }).waitFor();
  assert.ok(!(await bea.locator("#expenseDialog").evaluate(d => d.open)), "dialog closes after saving");
  const dinnerRow = bea.locator("#expenseRows tr.exp-row", { hasText: "Dinner" });
  assert.match((await dinnerRow.innerText()).replace(/\s+/g, " "), /Dinner You paid ₹100\.00 ₹100\.00 you lent ₹50\.00/);
  assert.match(await text(bea, "#groupStatus"), /You are owed ₹50\.00/);
  step("equal split via dialog: expense table shows 'you lent ₹50.00'");

  await bea.click("#openAddExpense");
  await bea.click("#splitManualMode");
  await bea.fill("#desc", "Snacks");
  await bea.fill("#amount", "10");
  const manualFor = async name => bea.locator("#manualSplitMembers .manual-split-amount").nth(await bea.locator("#manualSplitMembers label").evaluateAll((ls, n) => ls.findIndex(l => l.textContent.startsWith(n)), name));
  await (await manualFor("Bea")).fill("5.00");
  await (await manualFor("Cy")).fill("4.99");
  assert.match(await text(bea, "#manualSplitTotal"), /Allocated: ₹9\.99 \/ ₹10\.00 · ₹0\.01 left/);
  await bea.click("#saveExpense");
  await bea.locator("#expenseDialog .dialog-err", { hasText: "add up exactly" }).waitFor();
  await (await manualFor("Cy")).fill("5.00");
  assert.match(await text(bea, "#manualSplitTotal"), /Allocated: ₹10\.00 \/ ₹10\.00 ✓/);
  await bea.click("#saveExpense");
  await notice(bea).filter({ hasText: "Snacks” saved" }).waitFor();
  assert.equal(await bea.locator("#expenseRows tr.exp-row").count(), 2);
  await bea.locator("#expenseRows tr.exp-row", { hasText: "Snacks" }).click();
  const detail = bea.locator("#expenseRows tr.exp-detail:not(.hidden)");
  assert.match((await detail.innerText()).replace(/\s+/g, " "), /You paid ₹10\.00 · added by you .*Cy E2E ₹5\.00 ₹5\.00/);
  await bea.fill("#expenseSearch", "dinn");
  assert.equal(await bea.locator("#expenseRows tr.exp-row").count(), 1);
  await bea.fill("#expenseSearch", "");
  step("manual split: ₹5.00 + ₹4.99 rejected inside the dialog; row expands to show the split; search filters");
  await shot(bea, "bea-expenses");

  await memberSignIn(cy, "Cy E2E");
  assert.match(await text(cy, "#groupStatus"), /You owe ₹55\.00/);
  assert.match((await cy.locator("#expenseRows tr.exp-row", { hasText: "Dinner" }).innerText()).replace(/\s+/g, " "), /you borrowed ₹50\.00/);
  await cy.click(".g-tabs .tab[data-tab=balances]");
  assert.match(await text(cy, "#personList"), /Bea E2E you owe ₹55\.00/);
  await cy.locator("#personList .person-row", { hasText: "Bea E2E" }).click();
  await cy.locator("#personTitle", { hasText: "You and Bea E2E" }).waitFor();
  assert.match(await text(cy, "#personStatus"), /You owe Bea E2E ₹55\.00/);
  assert.equal(await cy.locator("#personRows tr").count(), 2);
  await shot(cy, "cy-person");
  await noHorizontalOverflow(cy, "person drill-down");
  step("person drill-down lists both shared expenses with a running balance");

  await cy.getByRole("button", { name: "Pay Bea E2E" }).click();
  assert.equal(await cy.inputValue("#settleAmount"), "55.00", "amount is prefilled with the full debt");
  assert.equal(await cy.textContent("#recordPayment"), "Record ₹55.00 payment");
  assert.match(await text(cy, "#settleHint"), /clears the full amount/);
  await cy.fill("#settleAmount", "60");
  assert.match(await text(cy, "#settleHint"), /more than the ₹55\.00 owed/);
  assert.ok(await cy.locator("#recordPayment").isDisabled(), "cannot overpay");
  await cy.click("#settleHalf");
  assert.equal(await cy.inputValue("#settleAmount"), "27.50");
  await cy.click("#settleOther");
  await cy.fill("#settleAmount", "20");
  assert.match(await text(cy, "#settleHint"), /Partial payment · ₹35\.00 will still be owed/);
  await shot(cy, "cy-settle-sheet");
  await cy.click("#recordPayment");
  await notice(cy).filter({ hasText: "Recorded ₹20.00 from Cy E2E to Bea E2E. ₹35.00 is still owed." }).waitFor();
  await cy.locator("#personStatus", { hasText: "₹35.00" }).waitFor();
  assert.equal(await cy.locator("#personRows tr").count(), 3);
  assert.match(await text(cy, "#personRows"), /You paid Bea E2E/);
  step("partial repayment ₹20 from the drill-down → Cy now owes ₹35; overpay disabled; half chip works");

  await cy.click("#openSettle");
  assert.equal(await cy.inputValue("#settleAmount"), "35.00", "header Settle up goes straight to the only debt, prefilled");
  await cy.click("#recordPayment");
  await notice(cy).filter({ hasText: "All settled" }).waitFor();
  await cy.locator("#personStatus", { hasText: "You are settled up" }).waitFor();
  await cy.click("#backToBalances");
  assert.match(await text(cy, "#balances"), /Cy E2E \(you\) ₹0\.00 · settled/);
  assert.match(await text(cy, "#whoOwesWhom"), /Everyone is settled up/);
  assert.match(await text(cy, "#groupStatus"), /You are all settled up/);
  await cy.click(".g-tabs .tab[data-tab=payments]");
  assert.equal(await cy.locator("#settlementHistory tr").count(), 2);
  assert.match(await text(cy, "#settlementHistory"), /You paid Bea E2E/);
  step("header Settle up prefills the remaining ₹35.00 and clears the debt; payments table shows both");
  await shot(cy, "cy-payments");
  await noHorizontalOverflow(cy, "payments tab");

  await bea.reload();
  await memberSignIn(bea, "Bea E2E");
  assert.match(await text(bea, "#groupStatus"), /You are all settled up/);
  await bea.click(".g-tabs .tab[data-tab=insights]");
  assert.match(await text(bea, "#groupTotalSpent"), /₹110\.00/);
  await bea.click("#backToGroups");
  assert.ok(await bea.locator("#groupsCard").isVisible() && await bea.locator("#groupPanel").isHidden());
  assert.match(await text(bea, "#groups"), /settled up/);
  step("creditor view refreshed; back to groups shows per-group status");
  await admin.goto(BASE + "/");
  await adminLogin(admin);
  await admin.locator("#dashboardRecent table tbody tr").first().waitFor();
  assert.match(await text(admin, "#dashboardRecent"), /Snacks .*₹10\.00/);
  await admin.click("#dashExpensesTab");
  await admin.locator("#dashboardExpensesList table").waitFor();
  await admin.selectOption("#adminExpenseGroup", { label: GROUP });
  assert.equal(await admin.locator("#dashboardExpensesList tbody tr").count(), 2);
  assert.match(await text(admin, "#adminExpenseSummary"), /2 expenses · ₹110\.00/);
  await noHorizontalOverflow(admin, "admin dashboard");
  await shot(admin, "admin-expenses");
  step("admin dashboard shows recent and all expenses as tables with a group filter");
  console.log("E2E PASSED");
} finally {
  await browser.close();
}
