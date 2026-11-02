// "Share as Excel" for one person in a group: a workbook with
//  1. a Summary sheet: every expense they paid for or share in (date, spent
//     on, paid by, cost, their share, cumulative share) and their totals,
//     plus where they stand with each person;
//  2. one sheet per other member: what's between the two of them, expense by
//     expense, and each payment with whether it was paid back (confirmed),
//     is waiting for approval, or was rejected, with a running balance.
//     Waivers ("no need to pay": the lender let them off) are listed as
//     "Let off" and totalled apart from money paid back.
import { get, type Statement, type StatementItem as Item } from "@/lib/api";
import { buildXlsx, type Cell, type Sheet } from "@/lib/xlsx";

export type { Statement };

const rs = (cents: number) => Math.round(cents) / 100;
const money = (cents: number): Cell => ({ v: rs(cents), s: "money" });
const bold = (v: string | number): Cell => ({ v, s: "bold" });
const head = (v: string): Cell => ({ v, s: "header" });
const when = (ts: number) => new Date(ts).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
const inrText = (cents: number) => "₹" + (Math.abs(cents) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function statementWorkbook(s: Statement): { file: Uint8Array; fileName: string } {
  const P = s.person.name;
  const t = s.totals;
  const summary: Cell[][] = [
    [{ v: `${P} · ${s.group.name}`, s: "title" }],
    [{ v: `Split It statement · made ${when(s.generatedAt)} · amounts in ₹`, s: "muted" }],
    [],
    [head("Date"), head("Spent on"), head("Paid by"), head("Cost"), head(`${P}'s share`), head(`Cumulative share`)],
    ...s.expenses.map(e => [when(e.createdAt), e.description, e.paidByName, money(e.totalCents), money(e.shareCents), money(e.cumulativeShareCents)]),
    ...(s.expenses.length ? [] : [[{ v: "No expenses yet.", s: "muted" } as Cell]]),
    [],
    [bold("Totals")],
    [`Spent on all of ${P}'s expenses`, "", "", money(s.expenses.reduce((a, e) => a + e.totalCents, 0))],
    [`Paid by ${P}`, "", "", money(t.paidCents)],
    [`${P}'s share`, "", "", money(t.shareCents)],
    [bold(t.balanceCents > 0 ? `${P} gets back` : t.balanceCents < 0 ? `${P} owes` : `${P} is settled up`), "", "", { v: rs(Math.abs(t.balanceCents)), s: "boldMoney" }],
    [{ v: "After payments that were confirmed. Each person's sheet has the details.", s: "muted" }],
    [],
    [head("With"), head("Where they stand"), head(""), head("Amount")],
    ...s.pairs.map(p => [p.name + (p.active ? "" : " (left)"), p.netCents > 0 ? `${p.name} owes ${P}` : p.netCents < 0 ? `${P} owes ${p.name}` : "Settled up", "", money(Math.abs(p.netCents))]),
  ];
  const sheets: Sheet[] = [{ name: "Summary", widths: [22, 34, 18, 14, 16, 18], rows: summary, freezeRow: 4 }];

  for (const p of s.pairs) {
    const waiver = (i: Item) => i.kind === "waiver";
    const status = (i: Item) => i.type === "expense" ? "Counted" : i.status === "pending" ? "Waiting for approval (not counted yet)" : i.status === "rejected" ? "Rejected (not counted)" : waiver(i) ? "Let off (approved)" : "Paid back (confirmed)";
    const counted = (letOff: boolean) => p.items.filter(i => i.type === "payment" && waiver(i) === letOff && (i.status === "counted" || i.status === "confirmed")).reduce((a, i) => a + (i.amountCents || 0), 0);
    const paidBack = counted(false), letOff = counted(true);
    const rows: Cell[][] = [
      [{ v: `${P} and ${p.name}`, s: "title" }],
      [{ v: `${s.group.name} · positive means ${p.name} owes ${P}, negative means ${P} owes ${p.name}`, s: "muted" }],
      [],
      [head("Date"), head("What"), head("Paid by"), head("Cost"), head(`${P}'s side`), head("Running balance"), head("Status")],
      ...p.items.map(i => i.type === "expense"
        ? [when(i.createdAt), i.description, i.paidByName, money(i.totalCents || 0), money(i.effectCents), money(i.runningCents), status(i)]
        : waiver(i) ? [when(i.createdAt), `Let off: ${i.toName} let ${i.fromName} off (no need to pay)`, "", money(i.amountCents || 0), money(i.effectCents), money(i.runningCents), status(i)]
        : [when(i.createdAt), `Payment: ${i.fromName} → ${i.toName}`, i.fromName, money(i.amountCents || 0), money(i.effectCents), money(i.runningCents), status(i)]),
      ...(p.items.length ? [] : [[{ v: "Nothing between them yet.", s: "muted" } as Cell]]),
      [],
      [bold("Result"), bold(p.netCents > 0 ? `${p.name} owes ${P} ${inrText(p.netCents)}` : p.netCents < 0 ? `${P} owes ${p.name} ${inrText(p.netCents)}` : "Settled up")],
      ["Paid back so far (confirmed)", "", "", money(paidBack)],
      ...(letOff ? [["Let off (no need to pay)", "", "", money(letOff)]] : []),
      ["Settled?", p.netCents === 0 ? "Yes" : "Not yet"],
    ];
    sheets.push({ name: p.name, widths: [22, 34, 18, 14, 16, 18, 34], rows, freezeRow: 4 });
  }
  const safe = (x: string) => x.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, " ") || "statement";
  return { file: buildXlsx(sheets), fileName: `Split It - ${safe(P)} - ${safe(s.group.name)}.xlsx` };
}

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
// Builds the workbook and shares it (phone share sheet: WhatsApp, Drive, mail…),
// or downloads it where sharing files isn't available.
export async function shareStatement(groupId: string, memberId: string): Promise<"shared" | "downloaded" | "cancelled"> {
  const s = await get<Statement>(`/api/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(memberId)}/statement`);
  const { file, fileName } = statementWorkbook(s);
  const blob = new Blob([file as BlobPart], { type: XLSX_TYPE });
  const f = new File([blob], fileName, { type: XLSX_TYPE });
  if (navigator.canShare?.({ files: [f] })) {
    try { await navigator.share({ files: [f], title: fileName.replace(/\.xlsx$/, "") }); return "shared"; }
    catch (e) { if ((e as Error).name === "AbortError") return "cancelled"; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = fileName;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "downloaded";
}
