import * as React from "react";
import { AnimatePresence, m } from "motion/react";
import { toast } from "sonner";
import { ArrowRight, ChevronLeft, ChevronRight, PartyPopper } from "lucide-react";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { List, LoadingButton, PersonAvatar, SectionTitle, haptic, pressableRow } from "@/components/app/bits";
import { SheetHeader } from "./AddExpenseDrawer";
import { useDebts, useMine, useRecordPayment } from "@/hooks/queries";
import type { Debt } from "@/lib/api";
import { centsToInput, inr, toCents } from "@/lib/money";
import { cn } from "@/lib/utils";

const key = (d: Pick<Debt, "fromMemberId" | "toMemberId">) => d.fromMemberId + ">" + d.toMemberId;
const IOS_EASE = [0.32, 0.72, 0, 1] as const;

// Step 1 picks who pays whom (skipped when there is only one choice);
// step 2 records all or part of it, prefilled with the full amount.
export function SettleUpDrawer({ groupId, open, onOpenChange, initial }: {
  groupId: string; open: boolean; onOpenChange: (o: boolean) => void; initial?: Pick<Debt, "fromMemberId" | "toMemberId"> | null;
}) {
  const debts = useDebts(groupId), mine = useMine(groupId), pay = useRecordPayment(groupId);
  const meId = mine.data?.memberId;
  const options = React.useMemo(() => (debts.data || []).filter(d => d.canRecord)
    .sort((a, b) => Number(b.fromMemberId === meId) - Number(a.fromMemberId === meId) || b.amountCents - a.amountCents), [debts.data, meId]);
  const [chosen, setChosen] = React.useState<string | null>(null);
  const [amount, setAmount] = React.useState("");
  const [error, setError] = React.useState("");
  const debt = options.find(d => key(d) === chosen) || null;

  const choose = React.useCallback((d: Debt | null) => { setChosen(d ? key(d) : null); setAmount(d ? centsToInput(d.amountCents) : ""); setError(""); }, []);
  React.useEffect(() => {
    if (!open) return;
    const wanted = initial ? options.find(d => key(d) === key(initial)) : options.length === 1 ? options[0] : null;
    choose(wanted || null);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const cents = toCents(amount);
  const over = !!debt && !!cents && cents > debt.amountCents;
  const left = debt && cents && !over ? debt.amountCents - cents : null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!debt || !cents || over) return;
    pay.mutate({ fromMemberId: debt.fromMemberId, toMemberId: debt.toMemberId, amount: amount.trim() }, {
      onSuccess: () => {
        haptic([10, 40, 14]);
        const remaining = debt.amountCents - cents;
        toast.success(`Recorded ${inr(cents)} from ${debt.fromName} to ${debt.toName}.`, { description: remaining ? `${inr(remaining)} is still owed.` : "All settled between them ✓" });
        onOpenChange(false);
      },
      onError: err => setError(err.message),
    });
  };
  const sections = [
    { title: "Involving you", list: options.filter(d => d.fromMemberId === meId || d.toMemberId === meId) },
    { title: "Between others · you can record as admin", list: options.filter(d => d.fromMemberId !== meId && d.toMemberId !== meId) },
  ].filter(sec => sec.list.length);

  return (
    <Drawer open={open} onOpenChange={o => { if (!pay.isPending) onOpenChange(o); }} repositionInputs={false}>
      <DrawerContent className="mx-auto max-h-[94dvh] max-w-xl rounded-t-[14px] border-0">
        <SheetHeader title="Settle Up" description={debt ? "Pay all of it now, or just a part." : "Choose who is paying whom."} disabled={pay.isPending} />
        <div className="min-h-0 overflow-y-auto">
          <AnimatePresence mode="wait" initial={false}>
            {!debt ? (
              <m.div key="pick" initial={{ opacity: 0, x: -24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.25, ease: IOS_EASE }} className="space-y-6 px-4 pt-3 pb-8">
                {!options.length ? (
                  <div className="flex flex-col items-center py-8 text-center">
                    <div className="mb-3 grid size-14 place-items-center rounded-full bg-positive-soft text-positive"><PartyPopper className="size-7" /></div>
                    <p className="title-2">Nothing to Pay</p>
                    <p className="subhead mt-1.5 max-w-xs text-muted-foreground">If someone owes you, they record the payment from their own account.</p>
                  </div>
                ) : sections.map(sec => (
                  <div key={sec.title}>
                    {sections.length > 1 && <SectionTitle>{sec.title}</SectionTitle>}
                    <List inset={68}>
                      {sec.list.map(d => {
                        const iPay = d.fromMemberId === meId;
                        const other = iPay ? { id: d.toMemberId, name: d.toName } : { id: d.fromMemberId, name: d.fromName };
                        return (
                          <button key={key(d)} type="button" onClick={() => choose(d)} className={pressableRow}>
                            <PersonAvatar name={other.name} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[17px]">{iPay ? "Pay " + d.toName : `${d.fromName} pays ${d.toMemberId === meId ? "you" : d.toName}`}</span>
                              <span className="subhead block text-muted-foreground">{iPay ? "You owe" : d.fromName + " owes"} {inr(d.amountCents)}</span>
                            </span>
                            <span className={cn("tabular text-[17px]", iPay ? "text-negative" : d.toMemberId === meId ? "text-positive" : "text-muted-foreground")}>{inr(d.amountCents)}</span>
                            <ChevronRight className="size-[18px] text-[#c4c4c7] dark:text-[#5a5a5e]" strokeWidth={2.5} />
                          </button>
                        );
                      })}
                    </List>
                  </div>
                ))}
              </m.div>
            ) : (
              <m.form key="pay" onSubmit={submit} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24 }} transition={{ duration: 0.25, ease: IOS_EASE }} className="px-4 pt-1">
                {options.length > 1 && (
                  <button type="button" onClick={() => choose(null)} className="-ml-2 inline-flex cursor-pointer items-center text-[17px] text-tint transition-opacity active:opacity-50"><ChevronLeft className="size-6" strokeWidth={2.2} />Choose someone else</button>
                )}
                <div className="flex items-center justify-center gap-4 pt-4 pb-3">
                  <PersonAvatar name={debt.fromName} size="lg" />
                  <ArrowRight className="size-5 text-muted-foreground" />
                  <PersonAvatar name={debt.toName} size="lg" />
                </div>
                <p className="title-2 text-center">{debt.fromMemberId === meId ? "You" : debt.fromName} {debt.fromMemberId === meId ? "pay" : "pays"} {debt.toMemberId === meId ? "you" : debt.toName}</p>
                <p className="subhead mt-1 text-center text-muted-foreground">{debt.fromMemberId === meId ? "You owe" : debt.fromName + " owes"} <span className="tabular text-foreground">{inr(debt.amountCents)}</span> in total</p>

                <label htmlFor="settle-amount" className="sr-only">Amount paid</label>
                <div className={cn("mt-6 flex h-20 items-center justify-center rounded-[14px] bg-card px-5 focus-within:ring-2", over ? "ring-2 ring-negative/60" : "focus-within:ring-tint/40")}>
                  <span className="mr-1 font-rounded text-[34px] font-bold text-muted-foreground">₹</span>
                  <input id="settle-amount" autoFocus inputMode="decimal" type="number" min="0.01" step="0.01" value={amount} onChange={e => { setAmount(e.target.value); setError(""); }}
                    className="tabular h-full w-full min-w-0 bg-transparent font-rounded text-[44px] leading-none font-bold tracking-[-0.02em] outline-none" placeholder="0.00" />
                </div>
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  {[["Full", debt.amountCents], ...(debt.amountCents >= 2 ? [["Half", Math.floor(debt.amountCents / 2)] as const] : [])].map(([labelText, c]) => (
                    <button key={labelText} type="button" onClick={() => { setAmount(centsToInput(c as number)); setError(""); }}
                      className={cn("cursor-pointer rounded-full px-3.5 py-1.5 text-[15px] transition-[background-color,opacity] duration-100 active:opacity-60", cents === c ? "bg-tint text-white" : "bg-tint-soft text-tint")}>
                      {labelText} · {inr(c as number)}
                    </button>
                  ))}
                  <button type="button" onClick={() => { setAmount(""); document.getElementById("settle-amount")?.focus(); }} className="cursor-pointer rounded-full bg-tint-soft px-3.5 py-1.5 text-[15px] text-tint transition-opacity active:opacity-60">Other amount</button>
                </div>
                <p aria-live="polite" className={cn("footnote mt-4 min-h-5 text-center", over || error ? "text-negative" : left === 0 ? "text-positive" : "text-muted-foreground")}>
                  {error || (!amount.trim() ? "Enter how much was paid." : !cents ? "Enter an amount like 250 or 249.50." : over ? `That's more than the ${inr(debt.amountCents)} owed.` : left === 0 ? "This clears the full amount ✓" : `Partial payment · ${inr(left!)} will still be owed after this.`)}
                </p>
                <div className="safe-bottom sticky bottom-0 -mx-4 mt-4 bg-background/85 px-4 pt-3 shadow-[inset_0_0.5px_0_var(--hairline)] backdrop-blur-xl">
                  <LoadingButton type="submit" size="xl" className="w-full" disabled={!cents || over} loading={pay.isPending} loadingText="Recording payment…">
                    {cents && !over ? `Record ${inr(cents)} payment` : "Record payment"}
                  </LoadingButton>
                </div>
              </m.form>
            )}
          </AnimatePresence>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
