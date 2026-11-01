import { History as HistoryIcon } from "lucide-react";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { EmptyState } from "@/components/app/bits";
import { SheetHeader } from "./AddExpenseDrawer";
import { useHistory } from "@/hooks/queries";
import type { HistoryEntry, HistorySnapshot } from "@/lib/api";
import { inr, shortDate } from "@/lib/money";

// What changed in an edit, in words: "₹90 → ₹120", "Cab → Cab to airport",
// "paid by Bea → Cy", "split between 2 → 3 people (Bea, Cy, Alex)".
function changes(b: HistorySnapshot, a: HistorySnapshot) {
  const out: string[] = [];
  if (b.description !== a.description) out.push(`“${b.description}” → “${a.description}”`);
  if (b.amountCents !== a.amountCents) out.push(`${inr(b.amountCents)} → ${inr(a.amountCents)}`);
  if (b.paidBy !== a.paidBy) out.push(`paid by ${b.paidByName} → ${a.paidByName}`);
  const key = (s?: HistorySnapshot["splits"]) => (s || []).map(x => x.memberId + ":" + x.amountCents).sort().join();
  if (key(b.splits) !== key(a.splits)) {
    const names = (s?: HistorySnapshot["splits"]) => (s || []).map(x => x.name).join(", ");
    out.push((b.splits?.length === a.splits?.length ? "shares changed" : `split between ${b.splits?.length} → ${a.splits?.length} people`) + ` (${names(a.splits)})`);
  }
  return out.length ? out : ["no visible change"];
}

function line(h: HistoryEntry, withName: boolean): { title: string; detail?: string } {
  const what = (s: HistorySnapshot | null) => (s ? `“${s.description}” ${inr(s.amountCents)}` : "");
  if (h.entity === "payment") {
    const b = h.before!;
    return { title: `${h.actorName} cancelled a payment`, detail: `${b.fromName} → ${b.toName} ${inr(b.amountCents)}${b.createdByName && b.createdByName !== b.fromName ? ` · recorded by ${b.createdByName}` : ""}` };
  }
  if (h.action === "created") return { title: `${h.actorName} added ${withName ? what(h.after) : "it"}`, detail: h.after ? `paid by ${h.after.paidByName}, split between ${h.after.splits?.length} people` : undefined };
  if (h.action === "deleted") return { title: `${h.actorName} deleted ${what(h.before)}`, detail: h.before ? `paid by ${h.before.paidByName}` : undefined };
  return { title: `${h.actorName} edited ${withName ? what(h.before) : "it"}`, detail: h.before && h.after ? changes(h.before, h.after).join(" · ") : undefined };
}

function Entries({ items, withName }: { items: HistoryEntry[]; withName: boolean }) {
  return (
    <ol className="space-y-2.5">
      {items.map(h => {
        const l = line(h, withName);
        return (
          <li key={h.id} className="text-[13px] leading-[18px]" data-testid="history-entry">
            <span className="font-medium text-foreground">{l.title}</span>
            <span className="block text-muted-foreground">{l.detail ? l.detail + " · " : ""}{shortDate(h.createdAt).full}</span>
          </li>
        );
      })}
    </ol>
  );
}

// Inside an opened expense: its changes, shown only once it has been edited.
export function ExpenseHistory({ groupId, expenseId }: { groupId: string; expenseId: string }) {
  const q = useHistory(groupId, expenseId);
  const edits = q.data?.filter(h => h.action === "edited") || [];
  if (!edits.length) return null;
  return (
    <div className="rounded-[16px] bg-white px-4 py-3 shadow-[0_1px_2px_rgb(16_40_32/5%)]" data-testid="expense-history">
      <p className="eyebrow mb-2 flex items-center gap-1.5"><HistoryIcon className="size-3.5" />Edited {edits.length === 1 ? "once" : `${edits.length} times`}</p>
      <Entries items={q.data!} withName={false} />
    </div>
  );
}

// The whole group's history: deleted and edited expenses, cancelled payments.
export function GroupHistorySheet({ groupId, open, onOpenChange }: { groupId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const q = useHistory(groupId, undefined, open);
  // Additions are already visible in the expense list; the sheet is about changes.
  const items = q.data?.filter(h => h.action !== "created");
  return (
    <Drawer open={open} onOpenChange={onOpenChange} repositionInputs={false}>
      <DrawerContent className="mx-auto max-h-[90dvh] max-w-xl rounded-t-[28px] border-0">
        <SheetHeader title="History" description="Edited and deleted expenses, cancelled payments" />
        <div className="safe-bottom min-h-0 overflow-y-auto px-5 pt-1 pb-6" data-testid="group-history">
          {q.isPending ? <p className="text-[13px] text-muted-foreground">Loading…</p>
            : !items?.length ? <EmptyState icon={<HistoryIcon />} title="Nothing changed yet">Edits, deletions and cancelled payments show up here.</EmptyState>
            : <div className="panel p-4"><Entries items={items} withName /></div>}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
