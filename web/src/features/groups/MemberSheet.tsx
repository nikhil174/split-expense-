import * as React from "react";
import { ChevronLeft, ChevronRight, ReceiptText } from "lucide-react";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { Skeleton } from "@/components/ui/skeleton";
import { DateBadge, EmptyState, List, PersonAvatar, SectionTitle, pressableRow } from "@/components/app/bits";
import { SheetHeader } from "./AddExpenseDrawer";
import { PairDetail } from "./PairDetail";
import { useMemberSummary } from "@/hooks/queries";
import { inr } from "@/lib/money";
import { navigate } from "@/lib/route";
import { cn } from "@/lib/utils";

// Tap anyone in "Group balances" to see their whole picture in the group:
// totals, who they owe and who owes them, every expense they are part of,
// and their payments.
export function MemberSheet({ groupId, memberId, onClose, meId }: { groupId: string; memberId: string | null; onClose: () => void; meId?: string }) {
  // Keep showing the last person while the sheet animates closed.
  const [shown, setShown] = React.useState<string | null>(memberId);
  React.useEffect(() => { if (memberId) setShown(memberId); }, [memberId]);
  const q = useMemberSummary(groupId, shown);
  // Tapping "Jagan owes Vicky" shows what is between those two, in this sheet.
  const [pair, setPair] = React.useState<{ creditorId: string; debtorId: string } | null>(null);
  React.useEffect(() => { setPair(null); }, [memberId]);
  const d = q.data;
  const name = d?.member.name ?? "";
  const label = (id: string, n: string) => (id === meId ? "you" : n);
  const b = d?.balanceCents ?? 0;

  return (
    <Drawer open={!!memberId} onOpenChange={o => { if (!o) onClose(); }}>
      <DrawerContent className="mx-auto max-h-[92dvh] max-w-xl rounded-t-[28px] border-0">
        <SheetHeader title={d ? name + (d.member.isMe ? " (you)" : "") : "Loading…"}
          description={!d ? "" : b > 0 ? `Gets back ${inr(b)} overall` : b < 0 ? `Owes ${inr(-b)} overall` : "Settled up"} />
        <div className="safe-bottom min-h-0 space-y-6 overflow-y-auto px-4 pt-1 pb-8">
          {pair ? (
            <div>
              <button type="button" onClick={() => setPair(null)} className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-[#141716]/[0.05] py-1.5 pr-3 pl-2 text-[13.5px] font-medium transition-transform active:scale-95">
                <ChevronLeft className="size-4" strokeWidth={2.4} />{name}
              </button>
              <PairDetail groupId={groupId} creditorId={pair.creditorId} debtorId={pair.debtorId} meId={meId} />
            </div>
          ) : !d ? <div className="space-y-3">{[0, 1, 2].map(i => <Skeleton key={i} className="h-14 w-full rounded-2xl" />)}</div> : (
            <>
              <div className="grid grid-cols-3 gap-2">
                {[["Paid", d.paidCents, ""], ["Their share", d.shareCents, ""], [b >= 0 ? "Gets back" : "Owes", Math.abs(b), b > 0 ? "text-positive" : b < 0 ? "text-negative" : ""]].map(([t, c, cls]) => (
                  <div key={t as string} className="panel px-3 py-3 text-center">
                    <p className="text-[12px] text-muted-foreground">{t}</p>
                    <p className={cn("tabular mt-0.5 text-[15.5px] font-semibold", cls as string)}>{inr(c as number)}</p>
                  </div>
                ))}
              </div>

              {(d.owes.length > 0 || d.owedBy.length > 0) && (
                <section>
                  <SectionTitle>Who {d.member.isMe ? "you owe and who owes you" : `${name} owes and who owes ${name}`}</SectionTitle>
                  <List>
                    {d.owes.map(x => (
                      <button key={"o" + x.memberId} type="button" onClick={() => setPair({ creditorId: x.memberId, debtorId: d.member.id })} className={pressableRow}>
                        <span className="min-w-0 flex-1 truncate text-[15px]">{d.member.isMe ? "You owe" : "Owes"} <span className="font-medium">{label(x.memberId, x.name)}</span></span>
                        <span className="tabular text-[15px] font-medium text-negative">{inr(x.amountCents)}</span>
                        <ChevronRight className="size-[18px] shrink-0 text-[#141716]/25" strokeWidth={2.4} />
                      </button>
                    ))}
                    {d.owedBy.map(x => (
                      <button key={"b" + x.memberId} type="button" onClick={() => setPair({ creditorId: d.member.id, debtorId: x.memberId })} className={pressableRow}>
                        <span className="min-w-0 flex-1 truncate text-[15px]"><span className="font-medium">{x.memberId === meId ? "You" : x.name}</span> {x.memberId === meId ? "owe" : "owes"} {d.member.isMe ? "you" : name}</span>
                        <span className="tabular text-[15px] font-medium text-positive">{inr(x.amountCents)}</span>
                        <ChevronRight className="size-[18px] shrink-0 text-[#141716]/25" strokeWidth={2.4} />
                      </button>
                    ))}
                  </List>
                </section>
              )}

              <section>
                <SectionTitle>{d.expenses.length} {d.expenses.length === 1 ? "expense" : "expenses"}</SectionTitle>
                <div className="panel overflow-hidden">
                  {!d.expenses.length ? <EmptyState icon={<ReceiptText />} title="No expenses">{name} isn't part of any expense yet.</EmptyState> : (
                    <ul>
                      {d.expenses.map(x => (
                        <li key={x.id} className="flex items-center gap-3 border-b border-hairline px-4 py-3 last:border-0">
                          <DateBadge ts={x.createdAt} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[15px] font-medium">{x.description}</span>
                            <span className="footnote block truncate text-muted-foreground">{x.paidBy === meId ? "You" : x.paidByName} paid {inr(x.amountCents)}{x.shareCents ? ` · ${d.member.isMe ? "your" : "their"} share ${inr(x.shareCents)}` : ` · not in the split`}</span>
                          </span>
                          <span className={cn("tabular text-right text-[14.5px] font-medium whitespace-nowrap", x.effectCents > 0 ? "text-positive" : x.effectCents < 0 ? "text-negative" : "text-muted-foreground")}>
                            {x.effectCents > 0 ? "lent " + inr(x.effectCents) : x.effectCents < 0 ? "owes " + inr(-x.effectCents) : "—"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>

              {d.payments.length > 0 && (
                <section>
                  <SectionTitle>Payments</SectionTitle>
                  <div className="panel overflow-hidden">
                    <ul>
                      {d.payments.map(x => (
                        <li key={x.id} className="flex items-center gap-3 border-b border-hairline px-4 py-3 last:border-0">
                          <DateBadge ts={x.createdAt} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[15px] font-medium">{x.fromMemberId === meId ? "You" : x.fromName} paid {label(x.toMemberId, x.toName)}</span>
                            <span className="footnote block text-muted-foreground">{x.status === "pending" ? `Waiting for ${label(x.toMemberId, x.toName)} to confirm` : "Confirmed"}</span>
                          </span>
                          <span className={cn("tabular text-[14.5px] font-medium", x.status === "pending" && "text-muted-foreground")}>{inr(x.amountCents)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </section>
              )}

              {!d.member.isMe && (
                <button type="button" onClick={() => { onClose(); navigate({ name: "person", groupId, memberId: d.member.id }); }}
                  className="flex w-full cursor-pointer items-center gap-3 rounded-[18px] bg-white px-4 py-3.5 text-left shadow-[0_1px_2px_rgb(16_40_32/5%)] transition-transform active:scale-[0.98]">
                  <PersonAvatar id={d.member.id} name={name} size="sm" />
                  <span className="min-w-0 flex-1 text-[15px] font-medium">Just you and {name}</span>
                  <ChevronRight className="size-[18px] text-[#141716]/30" strokeWidth={2.4} />
                </button>
              )}
            </>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
