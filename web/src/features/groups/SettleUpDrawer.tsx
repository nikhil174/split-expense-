import * as React from "react";
import { AnimatePresence, m } from "motion/react";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, ChevronRight, PartyPopper } from "lucide-react";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { EASE, LoadingButton, PersonAvatar } from "@/components/app/bits";
import { useDebts, useMine, useRecordPayment } from "@/hooks/queries";
import type { Debt } from "@/lib/api";
import { centsToInput, inr, toCents } from "@/lib/money";
import { cn } from "@/lib/utils";

const key = (d: Pick<Debt, "fromMemberId" | "toMemberId">) => d.fromMemberId + ">" + d.toMemberId;

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
        const remaining = debt.amountCents - cents;
        toast.success(`Recorded ${inr(cents)} from ${debt.fromName} to ${debt.toName}.`, { description: remaining ? `${inr(remaining)} is still owed.` : "All settled between them ✓" });
        onOpenChange(false);
      },
      onError: err => setError(err.message),
    });
  };
  const nameOf = (id: string, name: string) => (id === meId ? "You" : name);

  return (
    <Drawer open={open} onOpenChange={o => { if (!pay.isPending) onOpenChange(o); }} repositionInputs={false}>
      <DrawerContent className="mx-auto max-h-[94dvh] max-w-xl rounded-t-3xl">
        <DrawerHeader className="pb-1 text-left">
          <DrawerTitle className="text-xl">Settle up</DrawerTitle>
          <DrawerDescription>{debt ? "Pay all of it now, or just a part." : "Choose who is paying whom."}</DrawerDescription>
        </DrawerHeader>
        <div className="min-h-0 overflow-y-auto">
          <AnimatePresence mode="wait" initial={false}>
            {!debt ? (
              <m.div key="pick" initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.2, ease: EASE }} className="px-4 pt-2 pb-6">
                {!options.length ? (
                  <div className="flex flex-col items-center py-8 text-center">
                    <div className="mb-3 grid size-12 place-items-center rounded-2xl bg-positive-soft text-positive"><PartyPopper className="size-6" /></div>
                    <p className="font-semibold">Nothing for you to pay</p>
                    <p className="mt-1 max-w-xs text-sm text-muted-foreground">If someone owes you, they record the payment from their own account.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {[
                      { title: "Involving you", list: options.filter(d => d.fromMemberId === meId || d.toMemberId === meId) },
                      { title: "Between others · you can record as admin", list: options.filter(d => d.fromMemberId !== meId && d.toMemberId !== meId) },
                    ].filter(sec => sec.list.length).map((sec, _i, all) => (
                      <div key={sec.title}>
                        {all.length > 1 && <p className="mb-1.5 px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{sec.title}</p>}
                        <div className="overflow-hidden rounded-2xl border bg-card">
                          {sec.list.map(d => {
                            const iPay = d.fromMemberId === meId;
                            const other = iPay ? { id: d.toMemberId, name: d.toName } : { id: d.fromMemberId, name: d.fromName };
                            return (
                              <button key={key(d)} type="button" onClick={() => choose(d)} className="flex w-full cursor-pointer items-center gap-3 border-b px-4 py-3.5 text-left transition-colors last:border-0 hover:bg-muted/60 active:bg-muted">
                                <PersonAvatar id={other.id} name={other.name} />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate font-medium">{iPay ? "Pay " + d.toName : `${d.fromName} pays ${d.toMemberId === meId ? "you" : d.toName}`}</span>
                                  <span className="block text-xs text-muted-foreground">{iPay ? "You owe" : d.fromName + " owes"} {inr(d.amountCents)}</span>
                                </span>
                                <span className={cn("tabular font-semibold", iPay ? "text-negative" : d.toMemberId === meId ? "text-positive" : "text-foreground")}>{inr(d.amountCents)}</span>
                                <ChevronRight className="size-4 text-muted-foreground" />
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </m.div>
            ) : (
              <m.form key="pay" onSubmit={submit} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }} transition={{ duration: 0.2, ease: EASE }} className="px-4 pt-1">
                {options.length > 1 && (
                  <button type="button" onClick={() => choose(null)} className="mb-1 inline-flex cursor-pointer items-center gap-1 text-sm font-medium text-primary"><ArrowLeft className="size-4" />Choose someone else</button>
                )}
                <div className="flex items-center justify-center gap-4 py-3">
                  <PersonAvatar id={debt.fromMemberId} name={debt.fromName} size="lg" />
                  <ArrowRight className="size-5 text-muted-foreground" />
                  <PersonAvatar id={debt.toMemberId} name={debt.toName} size="lg" />
                </div>
                <p className="text-center text-lg font-semibold">{nameOf(debt.fromMemberId, debt.fromName)} {debt.fromMemberId === meId ? "pay" : "pays"} {debt.toMemberId === meId ? "you" : debt.toName}</p>
                <p className="mt-0.5 text-center text-sm text-muted-foreground">{debt.fromMemberId === meId ? "You owe" : debt.fromName + " owes"} <span className="tabular font-semibold text-foreground">{inr(debt.amountCents)}</span> in total</p>

                <label htmlFor="settle-amount" className="sr-only">Amount paid</label>
                <div className={cn("mt-5 flex h-16 items-center rounded-2xl border-2 bg-card px-4 transition-colors focus-within:border-primary", over ? "border-negative" : "border-input")}>
                  <span className="mr-1 text-3xl font-bold text-muted-foreground">₹</span>
                  <input id="settle-amount" autoFocus inputMode="decimal" type="number" min="0.01" step="0.01" value={amount} onChange={e => { setAmount(e.target.value); setError(""); }}
                    className="tabular h-full w-full min-w-0 bg-transparent text-3xl font-bold outline-none" placeholder="0.00" />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {[["Full", debt.amountCents], ...(debt.amountCents >= 2 ? [["Half", Math.floor(debt.amountCents / 2)] as const] : [])].map(([labelText, c]) => (
                    <button key={labelText} type="button" onClick={() => { setAmount(centsToInput(c as number)); setError(""); }}
                      className={cn("cursor-pointer rounded-full border px-3.5 py-2 text-sm font-semibold transition-all active:scale-95", cents === c ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted")}>
                      {labelText} · {inr(c as number)}
                    </button>
                  ))}
                  <button type="button" onClick={() => { setAmount(""); document.getElementById("settle-amount")?.focus(); }} className="cursor-pointer rounded-full border border-border bg-card px-3.5 py-2 text-sm font-semibold transition-all hover:bg-muted active:scale-95">Other amount</button>
                </div>
                <p aria-live="polite" className={cn("mt-3 min-h-5 text-sm font-medium", over || error ? "text-negative" : left === 0 ? "text-positive" : left ? "text-[oklch(0.6_0.13_70)]" : "text-muted-foreground")}>
                  {error || (!amount.trim() ? "Enter how much was paid." : !cents ? "Enter an amount like 250 or 249.50." : over ? `That's more than the ${inr(debt.amountCents)} owed.` : left === 0 ? "This clears the full amount ✓" : `Partial payment · ${inr(left!)} will still be owed after this.`)}
                </p>
                <div className="safe-bottom sticky bottom-0 -mx-4 mt-3 border-t bg-background/95 px-4 pt-3 backdrop-blur">
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
