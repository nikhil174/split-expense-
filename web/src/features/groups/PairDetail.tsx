import { ReceiptText } from "lucide-react";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { Skeleton } from "@/components/ui/skeleton";
import { DateBadge, EmptyState, PersonAvatar } from "@/components/app/bits";
import { SheetHeader } from "./AddExpenseDrawer";
import { usePair } from "@/hooks/queries";
import { inr } from "@/lib/money";
import { cn } from "@/lib/utils";
import * as React from "react";

// What is between two members, e.g. "Jagan owes Vicky ₹504": the expenses
// where one paid and the other had a share, and the payments between them,
// adding up to that amount. creditor/debtor only set which side reads first.
export function PairDetail({ groupId, creditorId, debtorId, meId }: { groupId: string; creditorId: string; debtorId: string; meId?: string }) {
  const q = usePair(groupId, creditorId, debtorId);
  const d = q.data;
  if (!d) return <div className="space-y-3 pt-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-12 w-full rounded-2xl" />)}</div>;
  const A = d.me, B = d.other; // netCents > 0: B owes A
  const nm = (id: string, name: string) => (id === meId ? "You" : name);
  const nameOf = (id: string) => (id === A.id ? A.name : B.name);
  const n = d.netCents;
  const owes = (debtor: { id: string; name: string }, creditor: { id: string; name: string }, cents: number) =>
    `${nm(debtor.id, debtor.name)} ${debtor.id === meId ? "owe" : "owes"} ${creditor.id === meId ? "you" : creditor.name} ${inr(cents)}`;
  return (
    <>
      <div className="flex items-center gap-3 pt-2 pb-4">
        <span className="flex -space-x-3">
          <PersonAvatar id={B.id} name={B.name} className="ring-2 ring-[#fbfbf9]" />
          <PersonAvatar id={A.id} name={A.name} className="ring-2 ring-[#fbfbf9]" />
        </span>
        <div className="min-w-0">
          <p className="title-2 truncate">{nm(B.id, B.name)} & {A.id === meId ? "you" : A.name}</p>
          <p className="text-[14px] font-medium text-muted-foreground">{n > 0 ? owes(B, A, n) : n < 0 ? owes(A, B, -n) : "Settled up"}</p>
        </div>
      </div>
      <div className="panel overflow-hidden">
        {!d.items.length ? <EmptyState icon={<ReceiptText />} title="Nothing between them">They don't share any expense or payment.</EmptyState> : (
          <ul>
            {d.items.map(it => {
              // effectCents > 0 means B owes A more because of this item.
              const debtor = it.effectCents > 0 ? B : A, creditor = it.effectCents > 0 ? A : B;
              return (
                <li key={it.type + it.id} className="flex items-center gap-3 border-b border-hairline px-4 py-3 last:border-0">
                  <DateBadge ts={it.createdAt} />
                  <span className="min-w-0 flex-1">
                    {it.type === "expense" ? (
                      <>
                        <span className="block truncate text-[15px] font-medium">{it.description}</span>
                        <span className="footnote block truncate text-muted-foreground">
                          {nm(creditor.id, creditor.name)} paid {inr(it.totalCents)} · {debtor.id === meId ? "your" : debtor.name + "'s"} share {inr(it.shareCents)}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="block truncate text-[15px] font-medium">{nm(it.fromMemberId!, nameOf(it.fromMemberId!))} paid {it.toMemberId === meId ? "you" : nameOf(it.toMemberId!)}</span>
                        <span className="footnote block text-muted-foreground">Payment</span>
                      </>
                    )}
                  </span>
                  <span className="text-right">
                    <span className={cn("tabular block text-[14.5px] font-medium whitespace-nowrap", it.type === "payment" ? "text-positive" : "text-foreground")}>
                      {it.type === "payment" ? "−" : "+"}{inr(Math.abs(it.effectCents))}
                    </span>
                    <span className="block text-[11.5px] whitespace-nowrap text-muted-foreground">{it.type === "payment" ? "paid back" : `${nm(debtor.id, debtor.name)} ${debtor.id === meId ? "owe" : "owes"}`}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {d.items.length > 0 && (
        <p className="footnote mt-2 px-2 text-muted-foreground">
          {n === 0 ? "These cancel out: nobody owes anything." : `Adds up to: ${n > 0 ? owes(B, A, n) : owes(A, B, -n)}. If both owe each other, only the difference is owed.`}
        </p>
      )}
    </>
  );
}

// "Who owes whom" rows open this.
export function PairSheet({ groupId, pair, onClose, meId }: { groupId: string; pair: { creditorId: string; debtorId: string } | null; onClose: () => void; meId?: string }) {
  const [shown, setShown] = React.useState(pair);
  React.useEffect(() => { if (pair) setShown(pair); }, [pair]);
  return (
    <Drawer open={!!pair} onOpenChange={o => { if (!o) onClose(); }}>
      <DrawerContent className="mx-auto max-h-[90dvh] max-w-xl rounded-t-[28px] border-0">
        <SheetHeader title="Between them" description="Every expense and payment between these two." />
        <div className="safe-bottom min-h-0 overflow-y-auto px-4 pt-1 pb-8">
          {shown && <PairDetail groupId={groupId} creditorId={shown.creditorId} debtorId={shown.debtorId} meId={meId} />}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
