import * as React from "react";
import { AnimatePresence, m } from "motion/react";
import { ChevronDown } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EASE } from "@/components/app/bits";
import { useExpenses } from "@/hooks/queries";
import { inr, shortDate } from "@/lib/money";
import { cn } from "@/lib/utils";

// The full split of one expense (who paid, who added it, each person's share
// and what they owe the payer): the same table as on the Expenses tab, for
// lists of expenses inside the person and "X owes Y" sheets.
export function ExpenseBreakdown({ groupId, expenseId, meId }: { groupId: string; expenseId: string; meId?: string }) {
  const expenses = useExpenses(groupId);
  const x = expenses.data?.find(e => e.id === expenseId);
  if (!x) return <div className="space-y-2 px-4 pb-4">{expenses.isPending ? [0, 1].map(i => <Skeleton key={i} className="h-8 w-full" />) : <p className="text-[13px] text-muted-foreground">This expense is no longer available.</p>}</div>;
  const who = (id: string, name: string) => (id === meId ? "You" : name);
  return (
    <div className="space-y-3 px-4 pb-4">
      <p className="text-[12.5px] text-muted-foreground">{who(x.paidBy, x.paidByName)} paid {inr(x.amountCents)} · added by {x.createdBy === meId ? "you" : x.createdByName} · {shortDate(x.createdAt).full}</p>
      <div className="overflow-hidden rounded-[16px] bg-white shadow-[0_1px_2px_rgb(16_40_32/5%)]">
        <table className="w-full text-[14px]">
          <thead><tr className="border-b border-hairline">{[["Person", ""], ["Share", "text-right"], ["Owes " + (x.paidBy === meId ? "you" : x.paidByName), "text-right"]].map(([c, cls]) => <th key={c} scope="col" className={cn("px-2 pt-3 pb-2 text-left text-[12px] font-medium text-muted-foreground first:pl-4 last:pr-4", cls)}>{c}</th>)}</tr></thead>
          <tbody>{x.splits.map(s => (
            <tr key={s.memberId} className="border-b border-hairline last:border-0">
              <td className="px-2 py-2.5 pl-4">{who(s.memberId, s.name)}</td>
              <td className="tabular px-2 py-2.5 text-right">{inr(s.amountCents)}</td>
              <td className="tabular px-2 py-2.5 pr-4 text-right text-muted-foreground">{s.memberId === x.paidBy ? "—" : inr(s.amountCents)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

// Wraps one row of an expense list: tap to open its split, tap again to close.
export function ExpandableExpense({ groupId, expenseId, meId, open, onToggle, children }: {
  groupId: string; expenseId: string; meId?: string; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  // Once it has opened, bring the whole split into view.
  const ref = React.useRef<HTMLLIElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 320);
    return () => window.clearTimeout(t);
  }, [open]);
  return (
    <li ref={ref} className={cn("scroll-mb-4 border-b border-hairline last:border-0", open && "bg-[#141716]/[0.025]")}>
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors active:bg-[#141716]/[0.04]">
        {children}
        <ChevronDown className={cn("size-4 shrink-0 text-[#141716]/30 transition-transform duration-200", open && "rotate-180")} strokeWidth={2.4} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <m.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.28, ease: EASE }} className="overflow-hidden">
            <ExpenseBreakdown groupId={groupId} expenseId={expenseId} meId={meId} />
          </m.div>
        )}
      </AnimatePresence>
    </li>
  );
}
