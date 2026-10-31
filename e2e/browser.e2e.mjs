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
  await sheet.getByRole("button", { name: /Bea E2E.*₹55\.00/s }).waitFor();
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
  // "Who owes whom": tapping a line shows the expenses behind it.
  await cy.locator("section", { has: cy.getByRole("heading", { name: "Who owes whom" }) }).getByRole("button", { name: /You\s*owe\s*Bea E2E/ }).click();
  const between = cy.getByRole("dialog");
  await between.getByText("You owe Bea E2E ₹55.00").first().waitFor();
  assert.equal(await between.locator("li").count(), 2, "Dinner and Snacks");
  await between.getByText("Dinner").waitFor();
  await cy.keyboard.press("Escape");
  await between.waitFor({ state: "detached" });
  await cy.getByRole("button", { name: /Bea E2E.*you owe.*₹55\.00/s }).click();
  await cy.getByRole("heading", { name: "You & Bea E2E" }).waitFor();
  await cy.getByText("You owe Bea E2E ₹55.00").waitFor();
  assert.equal(await cy.locator("tbody tr").count(), 2);
  await noHorizontalOverflow(cy, "person drill-down");
  await shot(cy, "cy-person");
  step("group balance opens the people popup; person drill-down lists both shared expenses with a running balance");

  // Bea adds her UPI ID and QR from the account menu; Cy then sees it when paying her.
  await bea.getByRole("button", { name: "Account" }).click();
  await bea.getByRole("menuitem", { name: "Your UPI" }).click();
  const upiSheet = bea.getByRole("dialog");
  await upiSheet.getByLabel("UPI ID").fill("bea.e2e@okaxis");
  await upiSheet.getByLabel("Choose QR image").setInputFiles({ name: "qr.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64") });
  await upiSheet.getByRole("img", { name: "Your UPI QR code" }).waitFor();
  await upiSheet.getByRole("button", { name: "Save UPI details" }).click();
  await toast(bea, "UPI details saved");
  await upiSheet.waitFor({ state: "detached" });
  step("member adds a UPI ID and QR code from the account menu");

  await cy.getByRole("button", { name: "Pay Bea E2E" }).click();
  const amount = cy.getByLabel("Amount paid");
  await amount.waitFor();
  const upi = cy.getByTestId("pay-by-upi");
  await upi.getByText("bea.e2e@okaxis").waitFor();
  await upi.getByRole("img", { name: "Bea E2E's UPI QR code" }).waitFor();
  assert.match(await upi.getByRole("link", { name: /in a UPI app/ }).getAttribute("href"), /^upi:\/\/pay\?pa=bea\.e2e@okaxis&pn=Bea%20E2E&cu=INR&am=55\.00/);
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
  await cy.getByLabel("Choose payment screenshot").setInputFiles({ name: "paid.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64") });
  await cy.getByText("Screenshot attached").waitFor();
  await cy.getByRole("button", { name: "Record ₹20.00 payment" }).click();
  await cy.getByRole("button", { name: "Recording payment…" }).waitFor();
  // The payment waits for Bea to confirm it; until then nothing changes.
  await toast(cy, "Sent ₹20.00 to Bea E2E to confirm");
  await cy.unroute("**/settlements");
  await cy.getByText("₹20.00 awaiting approval").waitFor();
  await cy.getByText("You sent this; it counts once Bea E2E approves it.").waitFor();
  await cy.getByText("You owe Bea E2E ₹55.00").waitFor();
  assert.equal(await cy.locator("tbody tr").count(), 2, "a pending payment is not in the history yet");
  // Bea sees it on Home and confirms.
  await bea.goto(BASE + "/#/");
  await bea.reload();
  await bea.getByText("Cy E2E says they paid you ₹20.00").waitFor();
  await bea.getByText("awaiting your approval").first().waitFor();
  await bea.getByRole("button", { name: "View Cy E2E's payment screenshot" }).click();
  await bea.getByRole("alertdialog").getByRole("img", { name: "Payment screenshot" }).waitFor();
  await bea.getByRole("button", { name: "Close" }).click();
  // The bell shows it too, and the Notifications screen lists it.
  const bell = bea.getByRole("button", { name: /^Notifications, \d+ unread$/ });
  await bell.waitFor();
  await bell.click();
  await bea.getByRole("heading", { name: "Notifications" }).waitFor();
  await bea.getByRole("button").filter({ hasText: "Cy E2E says they paid you ₹20.00" }).waitFor();
  await bea.getByRole("button", { name: "Notifications", exact: true }).waitFor(); // opening marks them read
  await bea.goto(BASE + "/#/");
  await bea.getByText("Cy E2E says they paid you ₹20.00").waitFor();
  await shot(bea, "bea-confirm");
  await bea.getByRole("button", { name: "Confirm ₹20.00 from Cy E2E" }).click();
  await toast(bea, "Confirmed ₹20.00 from Cy E2E");
  await bea.getByTestId("pending-payments").waitFor({ state: "detached" });
  await cy.reload();
  await cy.getByText("You owe Bea E2E ₹35.00").waitFor();
  assert.equal(await cy.locator("tbody tr").count(), 3);
  step("partial repayment ₹20 with a screenshot waits for Bea (⏳ badge, bell, Notifications); Bea views the screenshot and approves; then it counts");

  await cy.goBack();
  await cy.getByRole("heading", { name: GROUP }).waitFor();
  step("Android/browser back returns from the person to the group");
  await cy.getByRole("button", { name: "Settle up" }).click();
  assert.equal(await cy.getByLabel("Amount paid").inputValue(), "35.00", "only debt opens straight to payment, prefilled");
  await cy.getByRole("button", { name: "Record ₹35.00 payment" }).click();
  await toast(cy, "Sent ₹35.00 to Bea E2E to confirm");
  await cy.getByText("You paid Bea E2E ₹35.00").waitFor();
  // Bea says it never arrived: it is rejected and does not count.
  await bea.reload();
  await bea.getByRole("button", { name: "Reject ₹35.00 from Cy E2E" }).click();
  await toast(bea, "Rejected Cy E2E's payment");
  await cy.reload();
  await cy.getByRole("tab", { name: "Payments", exact: true }).click();
  await cy.getByText("Rejected by Bea E2E").waitFor();
  // Pay by UPI: tapping a person opens their QR and UPI ID; tapping the ID copies it.
  await cy.getByRole("button", { name: "Pay Bea E2E by UPI" }).click();
  const qrPop = cy.getByRole("alertdialog");
  await qrPop.getByRole("img", { name: "Bea E2E's UPI QR code" }).waitFor();
  await qrPop.getByRole("button", { name: "Copy UPI ID bea.e2e@okaxis" }).click();
  await cy.locator("[data-sonner-toast]").filter({ hasText: /UPI ID copied|bea\.e2e@okaxis/ }).first().waitFor();
  await qrPop.getByRole("button", { name: "Done" }).click();
  await qrPop.waitFor({ state: "detached" });
  // Cy pays again; Bea confirms; everyone is settled.
  await cy.getByRole("button", { name: "Settle up" }).click();
  await cy.getByRole("button", { name: "Record ₹35.00 payment" }).click();
  await toast(cy, "Sent ₹35.00 to Bea E2E to confirm");
  await bea.reload();
  await bea.getByRole("button", { name: "Confirm ₹35.00 from Cy E2E" }).click();
  await toast(bea, "Confirmed ₹35.00 from Cy E2E");
  await cy.reload();
  await cy.getByText("You are all settled up").waitFor();
  await cy.getByRole("tab", { name: "Payments", exact: true }).click();
  await cy.locator("tbody tr").nth(2).waitFor();
  assert.equal(await cy.locator("tbody tr").count(), 3, "two confirmed payments and the rejected one");
  assert.match(await cy.locator("tbody").innerText(), /You paid Bea E2E/);
  await cy.getByRole("tab", { name: "Balances", exact: true }).click();
  await cy.getByText("Everyone is settled up").waitFor();
  await noHorizontalOverflow(cy, "balances");
  // Tap anyone in Group balances for their whole picture.
  await cy.locator("section", { has: cy.getByRole("heading", { name: "Group balances" }) }).getByRole("button", { name: /Bea E2E/ }).click();
  const bea2 = cy.getByRole("dialog");
  await bea2.getByText("Settled up").waitFor();
  await bea2.getByText("2 expenses").waitFor();
  await bea2.getByText("Dinner").waitFor();
  await bea2.getByText("Snacks").waitFor();
  await bea2.getByText("You paid Bea E2E").first().waitFor();
  // Tapping an expense opens its full split, like on the Expenses tab.
  await bea2.getByRole("button").filter({ hasText: "Dinner" }).click();
  await bea2.getByRole("columnheader", { name: "Owes Bea E2E" }).waitFor();
  assert.equal(await bea2.locator("tbody tr").count(), 2, "Bea and Cy in the dinner split");
  await cy.keyboard.press("Escape");
  await bea2.waitFor({ state: "detached" });
  step("Settle up sends ₹35 for Bea to confirm; a rejected payment never counts; after confirming everyone is settled");

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

  // Group screen: "N members" opens a popup; the admin edits a name right there.
  await admin.getByRole("button", { name: /3 members/ }).click();
  const members = admin.getByRole("dialog");
  await members.getByRole("button", { name: "Rename Bea E2E" }).click();
  await members.getByLabel("New name for Bea E2E").fill("Beatrice E2E");
  await members.getByRole("button", { name: "Save name" }).click();
  await toast(admin, "Renamed to “Beatrice E2E”");
  await members.getByText("Beatrice E2E").waitFor();
  assert.equal(await members.getByRole("button", { name: /^Rename E2E Admin/ }).count(), 0, "the admin's own name is not edited here");
  await admin.keyboard.press("Escape");
  await members.waitFor({ state: "detached" });
  // A normal member sees who is in the group, but no Edit buttons.
  await cy.goto(BASE + "/#/");
  await cy.reload();
  await openGroup(cy);
  await cy.getByRole("button", { name: /3 members/ }).click();
  await cy.getByRole("dialog").getByText("Beatrice E2E").waitFor();
  // A member can edit only their own name.
  assert.deepEqual(await cy.getByRole("dialog").getByRole("button", { name: /^Rename / }).evaluateAll(els => els.map(e => e.getAttribute("aria-label"))), ["Rename Cyrus E2E"], "members rename only themselves");
  await cy.keyboard.press("Escape");
  await cy.getByRole("dialog").waitFor({ state: "detached" });
  // ...also from the account menu.
  await cy.getByRole("button", { name: "Account" }).click();
  await cy.getByRole("menuitem", { name: "Change your name" }).click();
  await cy.getByRole("alertdialog").getByLabel("Your name").fill("Cy Final");
  await cy.getByRole("button", { name: "Save name" }).click();
  await toast(cy, "You're now “Cy Final”");
  await cy.getByRole("button", { name: /3 members/ }).click();
  await cy.getByRole("dialog").getByText("Cy Final").waitFor();
  await cy.keyboard.press("Escape");
  await cy.getByRole("dialog").waitFor({ state: "detached" });
  step("tap 'N members': admin edits anyone's name; a member edits only their own (popup or account menu)");

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
  // Installable: manifest, icons and service worker are served, Chrome reports no
  // installability errors, and "Install the app" explains how on this phone.
  const fresh = await newPage();
  for (const path of ["/manifest.webmanifest", "/sw.js", "/icons/icon-192.png", "/icons/maskable-512.png", "/icons/apple-touch-icon.png"]) {
    assert.equal((await fresh.request.get(BASE + path)).status(), 200, path);
  }
  const cdp = await fresh.context().newCDPSession(fresh);
  await fresh.waitForFunction(async () => !!(await navigator.serviceWorker?.getRegistration()), null, { timeout: 15000 });
  assert.deepEqual((await cdp.send("Page.getInstallabilityErrors")).installabilityErrors, []);
  await fresh.getByRole("button", { name: "Install the app" }).click();
  await fresh.getByRole("alertdialog").getByText("Install Split It").waitFor();
  await fresh.getByRole("button", { name: "Got it" }).click();
  await fresh.getByRole("alertdialog").waitFor({ state: "detached" });
  await fresh.context().close();
  step("installable as an app: manifest, icons and service worker; install steps on the sign-in screen");
  console.log("E2E PASSED");
} finally {
  await browser.close();
}
