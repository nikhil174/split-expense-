// Browser end-to-end test against a running Worker (local `wrangler dev`).
// Not part of `npm test`; run with `npm run test:e2e` after starting
// `npx wrangler dev --local` with ADMIN_PIN set in .dev.vars.
//   E2E_BASE_URL    default http://127.0.0.1:8787
//   E2E_ADMIN_PIN   must match the running Worker's ADMIN_PIN
//   E2E_ADMIN_NAME  admin name (default "E2E Admin"; the first admin login saves it)
//   E2E_SHOTS_DIR   optional directory for screenshots
// Never point this at production: it creates groups, members and payments.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// createRequire so a globally installed Playwright (NODE_PATH) also works.
const { chromium, devices } = createRequire(import.meta.url)("playwright");

const BASE = process.env.E2E_BASE_URL || "http://127.0.0.1:8787";
const PIN = process.env.E2E_ADMIN_PIN;
const ADMIN = process.env.E2E_ADMIN_NAME || "E2E Admin";
const SHOTS = process.env.E2E_SHOTS_DIR;
if (!PIN) throw new Error("Set E2E_ADMIN_PIN");
if (/workers\.dev|split-expense\./.test(BASE) && !process.env.E2E_ALLOW_REMOTE) throw new Error("Refusing to run write tests against a deployed Worker");

const GROUP = "E2E Trip " + Date.now().toString(36);
const browser = await chromium.launch();
const step = name => console.log("✓", name);
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
const slow = (page, pattern) => page.route(pattern, async route => { if (route.request().method() === "POST") await new Promise(r => setTimeout(r, 1200)); await route.continue(); });

async function newPage() {
  const context = await browser.newContext(devices["Pixel 7"]);
  const page = await context.newPage();
  page.on("pageerror", e => { throw new Error("Page error: " + e.message); });
  await page.goto(BASE + "/");
  return page;
}
async function noHorizontalOverflow(page, label) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  assert.ok(sw <= cw, `${label}: page overflows horizontally (${sw} > ${cw})`);
}
const toast = (page, text) => page.locator("[data-sonner-toast]", { hasText: text }).first().waitFor();
const heroStatus = page => page.getByTestId("balance-card").innerText();

async function adminSignIn(page) {
  await page.getByRole("tab", { name: "Admin", exact: true }).click();
  await page.getByLabel("Admin name").fill(ADMIN);
  await page.getByLabel("PIN").fill(PIN);
  await page.getByRole("button", { name: "Sign in as admin" }).click();
  await page.getByRole("tab", { name: "Home", exact: true }).waitFor();
}
const MEMBER_PIN = "2468";
async function memberSignIn(page, name, pin = MEMBER_PIN) {
  await page.getByLabel("Group").selectOption({ label: GROUP });
  await page.getByLabel("Your approved name").fill(name);
  await page.getByLabel("PIN", { exact: true }).fill(pin);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("heading", { name: "Your groups" }).waitFor();
}
async function openGroup(page) {
  await page.getByRole("button", { name: new RegExp(GROUP) }).click();
  await page.getByRole("heading", { name: GROUP }).waitFor();
  await page.locator("button:enabled", { hasText: "Add expense" }).first().waitFor();
}

try {
  const admin = await newPage();
  await adminSignIn(admin);
  await admin.getByRole("tab", { name: "Admin", exact: true }).click();
  await admin.getByRole("tab", { name: "Groups", exact: true }).click();
  await admin.getByLabel("New group name").fill(GROUP);
  await admin.getByRole("button", { name: "Create" }).click();
  await toast(admin, "created");
  step("admin signed in (one identity, two views) and created a group");

  const bea = await newPage(), cy = await newPage();
  for (const [page, name] of [[bea, "Bea E2E"], [cy, "Cy E2E"]]) {
    await page.getByRole("tab", { name: "Request access", exact: true }).click();
    await page.getByLabel("Your name").waitFor();
    await page.getByLabel("Group").selectOption({ label: GROUP });
    await page.getByLabel("Your name").fill(name);
    await page.getByLabel("Choose a PIN").fill(MEMBER_PIN);
    await page.getByLabel("Confirm PIN").fill(MEMBER_PIN);
    await page.getByRole("button", { name: "Request access" }).click();
    await page.getByText("Waiting for approval").waitFor();
  }
  // The admin's own name is reserved: no second "person".
  const dup = await newPage();
  await dup.getByRole("tab", { name: "Request access", exact: true }).click();
  await dup.getByLabel("Your name").waitFor();
  await dup.getByLabel("Group").selectOption({ label: GROUP });
  await dup.getByLabel("Your name").fill(ADMIN);
  await dup.getByLabel("Choose a PIN").fill("1357");
  await dup.getByLabel("Confirm PIN").fill("1357");
  await dup.getByRole("button", { name: "Request access" }).click();
  await toast(dup, "administrator's name");
  await dup.context().close();

  await admin.getByRole("tab", { name: /Requests/ }).click();
  for (const name of ["Bea E2E", "Cy E2E"]) {
    await admin.getByRole("button", { name: "Approve " + name }).click();
    await toast(admin, name + " approved");
  }
  await shot(admin, "admin-requests");
  step("members requested access; admin's own name refused; admin approved both");

  // Bea continues from the request screen, Cy signs in by name.
  await bea.getByRole("button", { name: "Check approval" }).click();
  await bea.getByRole("button", { name: "Continue" }).click();
  await bea.getByRole("heading", { name: "Your groups" }).waitFor();
  await cy.getByRole("button", { name: "Request with a different name or group" }).click();
  await cy.getByRole("tab", { name: "Sign in", exact: true }).click();
  await cy.getByLabel("Your approved name").waitFor();
  // A wrong PIN is refused (with the tries left); the right one gets in.
  await cy.getByLabel("Group").selectOption({ label: GROUP });
  await cy.getByLabel("Your approved name").fill("Cy E2E");
  await cy.getByLabel("PIN", { exact: true }).fill("1111");
  await cy.getByRole("button", { name: "Sign in", exact: true }).click();
  await toast(cy, "Incorrect PIN. 4 tries left.");
  await memberSignIn(cy, "Cy E2E");
  await bea.reload();
  await bea.getByRole("heading", { name: "Your groups" }).waitFor();
  step("members request with a PIN; wrong PIN refused, right PIN signs in; session survives a reload");

  await openGroup(bea);
  await noHorizontalOverflow(bea, "group page");
  await bea.getByRole("button", { name: "Add expense" }).first().click();
  await bea.getByLabel("Description").fill("Dinner");
  await bea.getByLabel("Total").fill("100");
  assert.equal(await bea.getByLabel("Paid by").inputValue(), await bea.getByLabel("Paid by").locator("option", { hasText: "(you)" }).getAttribute("value"));
  // Nobody is in the split until chosen.
  assert.equal(await bea.getByRole("checkbox", { checked: true }).count(), 0, "no one pre-selected");
  assert.ok(await bea.getByRole("button", { name: "Save ₹100.00 expense" }).isDisabled(), "cannot save without choosing people");
  await bea.getByRole("checkbox", { name: "Bea E2E (you)" }).click();
  await bea.getByRole("checkbox", { name: "Cy E2E" }).click();
  await bea.getByText("₹50.00 each · 2 people").waitFor();
  await slow(bea, "**/expenses");
  await bea.getByRole("button", { name: "Save ₹100.00 expense" }).click();
  const saving = bea.getByRole("button", { name: "Saving…" });
  await saving.waitFor();
  assert.ok(await saving.isDisabled(), "save disabled while in flight");
  await toast(bea, "“Dinner” added");
  await bea.unroute("**/expenses");
  const dinnerRow = bea.getByRole("row", { name: /Dinner/ });
  await dinnerRow.waitFor();
  assert.match((await dinnerRow.innerText()).replace(/\s+/g, " "), /Dinner.*You paid ₹100\.00 you lent ₹50\.00/i);
  step("equal split: busy button while saving, table shows 'you lent ₹50.00'");

  await bea.getByRole("button", { name: "Add expense" }).first().click();
  assert.equal(await bea.getByLabel("Description").inputValue(), "", "form is fresh each time");
  await bea.getByLabel("Description").fill("Snacks");
  await bea.getByLabel("Total").fill("10");
  await bea.getByRole("tab", { name: "Exact amounts", exact: true }).click();
  await bea.getByLabel("Exact share for Bea E2E").fill("5.00");
  await bea.getByLabel("Exact share for Cy E2E").fill("4.99");
  await bea.getByText("₹0.01 left").waitFor();
  assert.ok(await bea.getByRole("button", { name: "Save ₹10.00 expense" }).isDisabled(), "mismatched exact split cannot be saved");
  await bea.getByLabel("Exact share for Cy E2E").fill("5");
  await bea.getByText("✓ Exact").waitFor();
  await bea.getByRole("button", { name: "Save ₹10.00 expense" }).click();
  await toast(bea, "“Snacks” added");
  await bea.getByRole("row", { name: /Snacks/ }).click();
  await bea.getByRole("cell", { name: "Cy E2E", exact: true }).waitFor();
  await bea.getByPlaceholder("Search by description or payer").fill("dinn");
  await bea.getByRole("row", { name: /Snacks/ }).waitFor({ state: "detached" });
  await bea.getByPlaceholder("Search by description or payer").fill("");
  await shot(bea, "bea-expenses");
  step("exact split: ₹5.00 + ₹4.99 blocked, exact saves; row expands; search filters");

  // Edit: open Dinner, it comes back prefilled; untick Cy and the split follows.
  const editButton = bea.getByRole("button", { name: "Edit", exact: true });
  await bea.getByRole("row", { name: /Dinner/ }).click();
  await bea.waitForFunction(() => [...document.querySelectorAll("button")].filter(b => b.textContent.trim() === "Edit").length === 1);
  await editButton.click();
  await bea.getByRole("heading", { name: "Edit expense" }).waitFor();
  assert.equal(await bea.getByLabel("Description").inputValue(), "Dinner");
  assert.equal(await bea.getByLabel("Total").inputValue(), "100.00");
  assert.deepEqual((await bea.getByRole("checkbox", { checked: true }).allInnerTexts()).map(t => t.split("\n").pop()), ["Bea E2E (you)", "Cy E2E"]);
  await bea.getByRole("checkbox", { name: "Cy E2E" }).click();
  await bea.getByRole("button", { name: "Save changes · ₹100.00" }).click();
  await toast(bea, "“Dinner” updated");
  await bea.getByRole("row", { name: /Dinner/ }).filter({ hasText: "not involved" }).or(bea.getByRole("row", { name: /Dinner.*your share/s })).first().waitFor();
  // Put Cy back so the rest of the walkthrough keeps its numbers (once the toast is out of the way).
  await bea.locator("[data-sonner-toast]").first().waitFor({ state: "detached", timeout: 15000 });
  const dinner = bea.locator("tr[aria-expanded]", { hasText: "Dinner" });
  if (await dinner.getAttribute("aria-expanded") !== "true") await dinner.click();
  await editButton.click();
  await bea.getByRole("heading", { name: "Edit expense" }).waitFor();
  await bea.getByRole("checkbox", { name: "Cy E2E" }).click();
  await bea.getByRole("button", { name: "Save changes · ₹100.00" }).click();
  await toast(bea, "“Dinner” updated");
  assert.match((await bea.getByRole("row", { name: /Dinner/ }).first().innerText()).replace(/\s+/g, " "), /you lent ₹50\.00/i);
  step("edit expense: prefilled; unticking a person removes them from the split; re-adding works");

  await cy.goto(BASE + "/#/");
  await cy.reload();
  // "You owe" on the Home card opens a popup (not a page) of the people you owe.
  await cy.getByRole("button", { name: /You owe.*₹55\.00/s }).click();
  const sheet = cy.getByRole("dialog");
  await sheet.getByRole("heading", { name: "You owe" }).waitFor();
  assert.equal(new URL(cy.url()).hash, "#/", "stays on Home");
  await sheet.getByRole("button", { name: /Bea E2E.*₹55\.00/s }).click();
  await sheet.getByText("You & Bea E2E").waitFor();
  await sheet.getByText("You owe Bea E2E ₹55.00").waitFor();
  await sheet.getByText("Dinner").waitFor();
  assert.equal(await sheet.locator("li").count(), 2, "both shared expenses listed in the popup");
  await noHorizontalOverflow(cy, "people popup");
  await shot(cy, "cy-people-popup");
  await sheet.getByRole("button", { name: "You owe", exact: true }).click();
  await sheet.getByRole("button", { name: /Bea E2E/ }).waitFor();
  await cy.keyboard.press("Escape");
  await sheet.waitFor({ state: "detached" });
  // "Owed to you" shows only that side.
  await cy.getByRole("button", { name: /Owed to you/ }).click();
  await cy.getByRole("dialog").getByText("Nobody owes you right now.").waitFor();
  await cy.keyboard.press("Escape");
  await cy.getByRole("dialog").waitFor({ state: "detached" });
  step("Home: You owe / Owed to you open a popup of people; tapping one shows your shared expenses in the popup");

  await openGroup(cy);
  assert.match((await heroStatus(cy)).replace(/\s+/g, " "), /you owe ₹55\.00/i);
  assert.match((await cy.getByRole("row", { name: /Dinner/ }).innerText()).replace(/\s+/g, " "), /you borrowed ₹50\.00/i);
  // Tapping the group's balance opens the same popup, limited to this group.
  await cy.getByTestId("balance-card").click();
  await cy.getByRole("dialog").getByRole("button", { name: /Bea E2E.*₹55\.00/s }).click();
  await cy.getByRole("dialog").getByText("You & Bea E2E").waitFor();
  await cy.keyboard.press("Escape");
  await cy.getByRole("dialog").waitFor({ state: "detached" });
  await cy.getByRole("tab", { name: "Balances", exact: true }).click();
  await cy.getByRole("button", { name: /Bea E2E.*you owe.*₹55\.00/s }).click();
  await cy.getByRole("heading", { name: "You & Bea E2E" }).waitFor();
  await cy.getByText("You owe Bea E2E ₹55.00").waitFor();
  assert.equal(await cy.locator("tbody tr").count(), 2);
  await noHorizontalOverflow(cy, "person drill-down");
  await shot(cy, "cy-person");
  step("group balance opens the people popup; person drill-down lists both shared expenses with a running balance");

  await cy.getByRole("button", { name: "Pay Bea E2E" }).click();
  const amount = cy.getByLabel("Amount paid");
  await amount.waitFor();
  assert.equal(await amount.inputValue(), "55.00", "prefilled with the full debt");
  await amount.fill("60");
  await cy.getByText("That's more than the ₹55.00 owed.").waitFor();
  assert.ok(await cy.getByRole("button", { name: "Record payment" }).isDisabled());
  await cy.getByRole("button", { name: /^Half/ }).click();
  assert.equal(await amount.inputValue(), "27.50");
  await cy.getByRole("button", { name: "Other amount" }).click();
  await amount.fill("20");
  await cy.getByText("Partial payment · ₹35.00 will still be owed after this.").waitFor();
  await shot(cy, "cy-settle");
  await slow(cy, "**/settlements");
  await cy.getByRole("button", { name: "Record ₹20.00 payment" }).click();
  await cy.getByRole("button", { name: "Recording payment…" }).waitFor();
  await toast(cy, "Recorded ₹20.00 from Cy E2E to Bea E2E");
  await cy.unroute("**/settlements");
  await cy.getByText("You owe Bea E2E ₹35.00").waitFor();
  assert.equal(await cy.locator("tbody tr").count(), 3);
  step("partial repayment ₹20 from the drill-down; overpay blocked; Half works; busy while recording");

  await cy.goBack();
  await cy.getByRole("heading", { name: GROUP }).waitFor();
  step("Android/browser back returns from the person to the group");
  await cy.getByRole("button", { name: "Settle up" }).click();
  assert.equal(await cy.getByLabel("Amount paid").inputValue(), "35.00", "only debt opens straight to payment, prefilled");
  await cy.getByRole("button", { name: "Record ₹35.00 payment" }).click();
  await toast(cy, "All settled between them");
  await cy.getByText("You are all settled up").waitFor();
  await cy.getByRole("tab", { name: "Payments", exact: true }).click();
  await cy.locator("tbody tr").nth(1).waitFor();
  assert.equal(await cy.locator("tbody tr").count(), 2);
  assert.match(await cy.locator("tbody").innerText(), /You paid Bea E2E/);
  await cy.getByRole("tab", { name: "Balances", exact: true }).click();
  await cy.getByText("Everyone is settled up").waitFor();
  await noHorizontalOverflow(cy, "balances");
  step("header Settle up clears the rest; payments table shows both; everyone settled");

  await admin.getByRole("tab", { name: "Home", exact: true }).click();
  await openGroup(admin);
  await admin.getByRole("tab", { name: "Insights", exact: true }).click();
  const people = await admin.locator("section", { hasText: "People" }).last().innerText();
  assert.equal(people.split(ADMIN).length - 1, 1, "admin appears once in the group");
  assert.match(people, new RegExp(ADMIN + " \\(you\\)"));
  await admin.getByRole("tab", { name: "Admin", exact: true }).click();
  await admin.getByRole("tab", { name: "Expenses", exact: true }).click();
  await admin.getByLabel("Filter by group").selectOption({ label: GROUP });
  assert.match(await admin.getByTestId("admin-expense-summary").innerText(), /2 expenses · ₹110\.00/);
  await noHorizontalOverflow(admin, "admin dashboard");
  await shot(admin, "admin-expenses");
  step("admin is one person in the group and switches between My groups and Admin");

  // Rename a member: the new name shows on their past expenses.
  await admin.getByRole("tab", { name: /^Requests/ }).click();
  await admin.getByRole("button", { name: "Actions for Cy E2E" }).click();
  await admin.getByRole("menuitem", { name: "Rename" }).click();
  await admin.getByLabel("New name").fill("Cyrus E2E");
  await admin.getByRole("button", { name: "Save name" }).click();
  await toast(admin, "Renamed to “Cyrus E2E”");
  await admin.getByRole("button", { name: "Actions for Cyrus E2E" }).waitFor();
  await admin.getByRole("tab", { name: "Home", exact: true }).click();
  await openGroup(admin);
  await admin.getByRole("tab", { name: "Payments", exact: true }).click();
  await admin.locator("tbody").getByText(/Cyrus E2E/).first().waitFor();
  assert.equal(await admin.locator("tbody").getByText(/\bCy E2E\b/).count(), 0, "old name gone from history");
  step("admin renames a member; the new name shows on their past payments");

  for (const page of [admin, cy]) {
    await page.getByRole("button", { name: "Account" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await page.getByRole("heading", { name: "Split It", level: 1 }).waitFor();
    assert.ok(new URL(page.url()).hash === "#/" || new URL(page.url()).hash === "", "sign-out resets the route");
    await page.reload();
    await page.getByRole("heading", { name: "Split It", level: 1 }).waitFor();
  }
  await adminSignIn(admin);
  await admin.getByRole("heading", { name: "Your groups" }).waitFor();
  step("sign out lands on the sign-in screen (admin and member), stays there after reload, and signing back in works");
  console.log("E2E PASSED");
} finally {
  await browser.close();
}
