import * as React from "react";
import { AnimatePresence, m } from "motion/react";
import { toast } from "sonner";
import { ArrowRight, ChevronLeft, ChevronRight, Image as ImageIcon, PartyPopper } from "lucide-react";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { List, LoadingButton, PersonAvatar, SectionTitle, haptic, pressableRow } from "@/components/app/bits";
import { SheetHeader } from "./AddExpenseDrawer";
import { PayByUpi } from "./UpiPayments";
import { shrinkScreenshot } from "@/lib/image";
import { glitterBurst } from "@/components/app/glitter";
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
  // What can still be recorded: the debt minus payments already sent and
  // waiting for the receiver to confirm (owedCents keeps the full debt).
  const options = React.useMemo(() => (debts.data || []).filter(d => d.canRecord)
    .map(d => ({ ...d, owedCents: d.amountCents, amountCents: d.amountCents - (d.waitingCents || 0) }))
    .filter(d => d.amountCents > 0)
    .sort((a, b) => Number(b.fromMemberId === meId) - Number(a.fromMemberId === meId) || b.amountCents - a.amountCents), [debts.data, meId]);
  const [chosen, setChosen] = React.useState<string | null>(null);
  const [amount, setAmount] = React.useState("");
  const [error, setError] = React.useState("");
  // Optional screenshot of the payment (e.g. the UPI success screen) for the receiver.
  const [proof, setProof] = React.useState<string | null>(null);
  const [proofBusy, setProofBusy] = React.useState(false);
  const proofInput = React.useRef<HTMLInputElement>(null);
  const pickProof = async (f: File | undefined) => {
    if (!f) return;
    setProofBusy(true); setError("");
    try { setProof(await shrinkScreenshot(f)); } catch (e) { setError((e as Error).message); }
    finally { setProofBusy(false); if (proofInput.current) proofInput.current.value = ""; }
  };
  const debt = options.find(d => key(d) === chosen) || null;

  const choose = React.useCallback((d: Debt | null) => { setChosen(d ? key(d) : null); setAmount(d ? centsToInput(d.amountCents) : ""); setError(""); setProof(null); }, []);
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
    pay.mutate({ fromMemberId: debt.fromMemberId, toMemberId: debt.toMemberId, amount: amount.trim(), ...(proof ? { proof } : {}) }, {
      onSuccess: res => {
        haptic([10, 40, 14]);
        const remaining = debt.amountCents - cents;
        glitterBurst({ strong: remaining === 0 && res.status === "confirmed" });
        // Most payments wait for the person who received them to confirm.
        if (res.status === "pending") toast.success(`Sent ${inr(cents)} to ${debt.toMemberId === meId ? "you" : debt.toName} to confirm.`, { description: `It counts once ${debt.toName} confirms they received it.` });
        else toast.success(`Recorded ${inr(cents)} from ${debt.fromName} to ${debt.toName}.`, { description: remaining ? `${inr(remaining)} is still owed.` : "All settled between them ✓" });
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
      <DrawerContent className="mx-auto max-h-[94dvh] max-w-xl rounded-t-[28px] border-0">
        <SheetHeader title="Settle up" description={debt ? "Pay all of it now, or just a part." : "Choose who is paying whom."} disabled={pay.isPending} />
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
                            <PersonAvatar id={other.id} name={other.name} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[15px] font-medium">{iPay ? "Pay " + d.toName : `${d.fromName} pays ${d.toMemberId === meId ? "you" : d.toName}`}</span>
                              <span className="subhead block text-muted-foreground">{iPay ? "You owe" : d.fromName + " owes"} {inr(d.amountCents)}</span>
                            </span>
                            <span className={cn("tabular text-[15px] font-medium", iPay ? "text-negative" : d.toMemberId === meId ? "text-positive" : "text-muted-foreground")}>{inr(d.amountCents)}</span>
                            <ChevronRight className="size-[18px] text-[#141716]/25" strokeWidth={2.4} />
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
                  <button type="button" onClick={() => choose(null)} className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-[#141716]/[0.05] py-1.5 pr-3 pl-2 text-[13.5px] font-medium transition-transform active:scale-95"><ChevronLeft className="size-4" strokeWidth={2.4} />Choose someone else</button>
                )}
                <div className="flex items-center justify-center gap-4 pt-4 pb-3">
                  <PersonAvatar id={debt.fromMemberId} name={debt.fromName} size="lg" />
                  <span className="grid size-9 place-items-center rounded-full bg-[#141716]/[0.05] text-foreground"><ArrowRight className="size-[18px]" strokeWidth={1.8} /></span>
                  <PersonAvatar id={debt.toMemberId} name={debt.toName} size="lg" />
                </div>
                <p className="title-2 text-center">{debt.fromMemberId === meId ? "You" : debt.fromName} {debt.fromMemberId === meId ? "pay" : "pays"} {debt.toMemberId === meId ? "you" : debt.toName}</p>
                <p className="subhead mt-1 text-center text-muted-foreground">{debt.fromMemberId === meId ? "You owe" : debt.fromName + " owes"} <span className="tabular text-foreground">{inr(debt.owedCents)}</span> in total{debt.owedCents > debt.amountCents ? <> · <span className="tabular">{inr(debt.owedCents - debt.amountCents)}</span> already waiting for {debt.toMemberId === meId ? "you" : debt.toName} to confirm</> : null}</p>

                <label htmlFor="settle-amount" className="sr-only">Amount paid</label>
                <div className={cn("mt-6 flex h-[84px] items-center justify-center rounded-[24px] border bg-white px-5 shadow-[0_1px_2px_rgb(16_40_32/5%)] transition-[border-color,box-shadow] focus-within:ring-[3px]", over ? "border-negative/50 ring-[3px] ring-negative/15" : "border-[#141716]/[0.08] focus-within:border-primary/50 focus-within:ring-primary/15")}>
                  <span className="mr-1 text-[30px] font-medium text-muted-foreground">₹</span>
                  <input id="settle-amount" autoFocus inputMode="decimal" type="number" min="0.01" step="0.01" value={amount} onChange={e => { setAmount(e.target.value); setError(""); }}
                    className="tabular h-full w-full min-w-0 bg-transparent text-[44px] leading-none font-medium tracking-[-0.03em] outline-none" placeholder="0.00" />
                </div>
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  {[["Full", debt.amountCents], ...(debt.amountCents >= 2 ? [["Half", Math.floor(debt.amountCents / 2)] as const] : [])].map(([labelText, c]) => (
                    <button key={labelText} type="button" onClick={() => { setAmount(centsToInput(c as number)); setError(""); }}
                      className={cn("cursor-pointer rounded-full px-4 py-2 text-[14px] font-medium transition-[background-color,transform] duration-150 active:scale-95", cents === c ? "bg-primary text-white" : "bg-white text-foreground ring-1 ring-[#141716]/[0.08]")}>
                      {labelText} · {inr(c as number)}
                    </button>
                  ))}
                  <button type="button" onClick={() => { setAmount(""); document.getElementById("settle-amount")?.focus(); }} className="cursor-pointer rounded-full bg-white px-4 py-2 text-[14px] font-medium text-foreground ring-1 ring-[#141716]/[0.08] transition-transform active:scale-95">Other amount</button>
                </div>
                {debt.fromMemberId === meId && <PayByUpi groupId={groupId} toMemberId={debt.toMemberId} amount={amount} />}
                <div className="panel mt-4 flex items-center gap-3 p-3">
                  {proof ? <img src={proof} alt="Payment screenshot" className="size-14 shrink-0 rounded-[10px] object-cover ring-1 ring-[#141716]/[0.08]" />
                    : <span className="grid size-14 shrink-0 place-items-center rounded-[10px] bg-[#141716]/[0.04] text-muted-foreground"><ImageIcon className="size-5" /></span>}
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14.5px] font-medium">{proof ? "Screenshot attached" : "Attach a screenshot"}</span>
                    <span className="block text-[12.5px] text-muted-foreground">Optional. Helps {debt.toMemberId === meId ? "you" : debt.toName} approve it.</span>
                  </span>
                  {proof
                    ? <button type="button" onClick={() => setProof(null)} className="shrink-0 cursor-pointer rounded-full bg-[#141716]/[0.05] px-3 py-1.5 text-[13px] font-medium">Remove</button>
                    : <button type="button" disabled={proofBusy} onClick={() => proofInput.current?.click()} className="shrink-0 cursor-pointer rounded-full bg-[#141716] px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-50">{proofBusy ? "Preparing…" : "Choose"}</button>}
                  <input ref={proofInput} type="file" accept="image/*" className="hidden" aria-label="Choose payment screenshot" onChange={e => pickProof(e.target.files?.[0])} />
                </div>
                <p aria-live="polite" className={cn("footnote mt-4 min-h-5 text-center", over || error ? "text-negative" : left === 0 ? "text-positive" : "text-muted-foreground")}>
                  {error || (!amount.trim() ? "Enter how much was paid." : !cents ? "Enter an amount like 250 or 249.50." : over ? `That's more than the ${inr(debt.amountCents)} owed.` : left === 0 ? "This clears the full amount ✓" : `Partial payment · ${inr(left!)} will still be owed after this.`)}
                </p>
                <div className="safe-bottom sticky bottom-0 -mx-4 mt-4 bg-[#fbfbf9]/90 px-4 pt-3 backdrop-blur-xl">
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
