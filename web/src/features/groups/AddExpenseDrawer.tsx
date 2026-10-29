import * as React from "react";
import { AnimatePresence, m } from "motion/react";
import { toast } from "sonner";
import { Check, X } from "lucide-react";
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { EASE, Footnote, List, LoadingButton, NativeSelect, PersonAvatar, SectionTitle, Segmented, fieldClass, haptic, pressableRow, rowClass } from "@/components/app/bits";
import { glitterBurst } from "@/components/app/glitter";
import { useAddExpense, useGroup, type NewExpense } from "@/hooks/queries";
import { inr, toCents } from "@/lib/money";
import { cn } from "@/lib/utils";

type Mode = "equal" | "manual";

// Sheet header: bold title on the left, round close button on the right.
export function SheetHeader({ title, description, disabled }: { title: string; description: string; disabled?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 pt-3 pb-3">
      <div className="min-w-0">
        <DrawerTitle className="text-[22px] leading-7 font-semibold tracking-[-0.02em]">{title}</DrawerTitle>
        <DrawerDescription className="mt-0.5 text-[13.5px] text-muted-foreground">{description}</DrawerDescription>
      </div>
      <DrawerClose disabled={disabled} aria-label="Cancel" className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-full bg-[#141716]/[0.06] text-foreground transition-transform active:scale-90 disabled:opacity-40"><X className="size-[18px]" strokeWidth={2.4} /></DrawerClose>
    </div>
  );
}

export function AddExpenseDrawer({ groupId, open, onOpenChange }: { groupId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const group = useGroup(groupId);
  const add = useAddExpense(groupId);
  const members = group.data?.members || [];
  const meId = group.data?.me.id;
  const [description, setDescription] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [paidBy, setPaidBy] = React.useState("");
  const [mode, setMode] = React.useState<Mode>("equal");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [manual, setManual] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState("");

  // Fresh form every time the sheet opens: payer = me, everyone selected.
  React.useEffect(() => {
    if (!open) return;
    setDescription(""); setAmount(""); setMode("equal"); setManual({}); setError("");
    setPaidBy(members.some(mm => mm.id === meId) ? meId! : members[0]?.id || "");
    setSelected(new Set(members.map(mm => mm.id)));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = toCents(amount);
  const label = (id: string, name: string) => name + (id === meId ? " (you)" : "");
  const allocated = Object.values(manual).reduce((s, v) => s + (v.trim() ? toCents(v) ?? NaN : 0), 0);
  const manualInvalid = Number.isNaN(allocated);
  const n = selected.size;

  const toggle = (id: string) => setSelected(s => { const next = new Set(s); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const valid = !!description.trim() && !!total && !!paidBy && (mode === "equal" ? n > 0 : !manualInvalid && allocated === total);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!total) return setError("Enter the total in rupees, with at most two decimals.");
    const body: NewExpense = mode === "equal"
      ? { description: description.trim(), amount: amount.trim(), paidBy, splitMode: "equal", memberIds: [...selected] }
      : { description: description.trim(), amount: amount.trim(), paidBy, splitMode: "manual", allocations: Object.entries(manual).filter(([, v]) => v.trim()).map(([memberId, v]) => ({ memberId, amount: v.trim() })) };
    add.mutate(body, {
      onSuccess: () => { haptic(); glitterBurst(); toast.success(`“${body.description}” added · ${inr(total)}`); onOpenChange(false); },
      onError: err => setError(err.message),
    });
  };

  return (
    <Drawer open={open} onOpenChange={o => { if (!add.isPending) onOpenChange(o); }} repositionInputs={false}>
      <DrawerContent className="mx-auto max-h-[94dvh] max-w-xl rounded-t-[28px] border-0">
        <SheetHeader title="Add expense" description="Everyone in the split owes their share to whoever paid." disabled={add.isPending} />
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pt-1 pb-5">
            <div>
              <label htmlFor="exp-desc" className="eyebrow mb-2 block px-1">Description</label>
              <Input id="exp-desc" required maxLength={160} autoComplete="off" placeholder="Dinner, cab, groceries…" value={description} onChange={e => setDescription(e.target.value)} className={fieldClass} />
            </div>
            <div className="grid grid-cols-[1.1fr_1fr] gap-3">
              <div>
                <label htmlFor="exp-amount" className="eyebrow mb-2 block px-1">Total</label>
                <div className="flex h-12 items-center rounded-[16px] border border-[#141716]/[0.08] bg-white px-4 shadow-[0_1px_2px_rgb(16_40_32/4%)] transition-[border-color,box-shadow] focus-within:border-primary/50 focus-within:ring-[3px] focus-within:ring-primary/15">
                  <span className="mr-1 text-[16px] text-muted-foreground">₹</span>
                  <input id="exp-amount" required inputMode="decimal" type="number" min="0.01" step="0.01" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} className="tabular h-full w-full min-w-0 bg-transparent text-[18px] font-semibold outline-none" />
                </div>
              </div>
              <div>
                <label htmlFor="exp-paid-by" className="eyebrow mb-2 block px-1">Paid by</label>
                <NativeSelect id="exp-paid-by" value={paidBy} onChange={e => setPaidBy(e.target.value)}>
                  {members.map(mm => <option key={mm.id} value={mm.id}>{label(mm.id, mm.name)}</option>)}
                </NativeSelect>
              </div>
            </div>

            <div>
              <Segmented id="split-mode" value={mode} onChange={setMode} options={[{ value: "equal", label: "Equally" }, { value: "manual", label: "Exact amounts" }]} />
              <AnimatePresence mode="wait" initial={false}>
                {mode === "equal" ? (
                  <m.div key="equal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15, ease: EASE }} className="mt-4">
                    <SectionTitle action={<button type="button" className="footnote cursor-pointer text-tint" onClick={() => setSelected(n === members.length ? new Set() : new Set(members.map(mm => mm.id)))}>{n === members.length ? "Clear all" : "Select all"}</button>}>Split between</SectionTitle>
                    <List inset={60}>
                      {members.map(mm => {
                        const on = selected.has(mm.id);
                        return (
                          <button key={mm.id} type="button" role="checkbox" aria-checked={on} onClick={() => toggle(mm.id)} className={pressableRow}>
                            <PersonAvatar id={mm.id} name={mm.name} size="sm" />
                            <span className="flex-1 truncate text-[15px]">{label(mm.id, mm.name)}</span>
                            <span className={cn("grid size-[22px] place-items-center rounded-full border-2 transition-colors duration-150", on ? "border-primary bg-primary text-white" : "border-[#141716]/20")}><Check className={cn("size-3.5 transition-opacity", on ? "opacity-100" : "opacity-0")} strokeWidth={3.2} /></span>
                          </button>
                        );
                      })}
                    </List>
                    <Footnote>
                      {!n ? "Choose at least one person." : total ? <><span className="tabular text-foreground">{inr(Math.floor(total / n))}{total % n ? "–" + inr(Math.ceil(total / n)) : ""}</span> each · {n} {n === 1 ? "person" : "people"}</> : `${n} ${n === 1 ? "person" : "people"} selected`}
                    </Footnote>
                  </m.div>
                ) : (
                  <m.div key="manual" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15, ease: EASE }} className="mt-4">
                    <SectionTitle>Exact shares</SectionTitle>
                    <List inset={60}>
                      {members.map(mm => (
                        <div key={mm.id} className={rowClass}>
                          <PersonAvatar id={mm.id} name={mm.name} size="sm" />
                          <label htmlFor={"manual-" + mm.id} className="min-w-0 flex-1 truncate text-[15px]">{label(mm.id, mm.name)}</label>
                          <span className="text-[15px] text-muted-foreground">₹</span>
                          <input id={"manual-" + mm.id} aria-label={"Exact share for " + mm.name} inputMode="decimal" type="number" min="0" step="0.01" placeholder="0.00"
                            value={manual[mm.id] || ""} onChange={e => setManual(v => ({ ...v, [mm.id]: e.target.value }))} className="tabular h-9 w-24 min-w-0 rounded-[12px] bg-[#141716]/[0.04] px-2.5 text-right text-[15px] font-semibold text-foreground outline-none placeholder:font-normal placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-primary/30" />
                        </div>
                      ))}
                    </List>
                    <ManualMeter allocated={manualInvalid ? null : allocated} total={total || 0} />
                  </m.div>
                )}
              </AnimatePresence>
            </div>
            <AnimatePresence>{error && <m.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} role="alert" className="subhead rounded-[16px] bg-negative-soft px-4 py-3 text-negative">{error}</m.p>}</AnimatePresence>
          </div>
          <div className="safe-bottom bg-[#fbfbf9]/90 px-4 pt-3 backdrop-blur-xl">
            <LoadingButton type="submit" size="xl" className="w-full" disabled={!valid} loading={add.isPending} loadingText="Saving…">
              {total ? `Save ${inr(total)} expense` : "Save expense"}
            </LoadingButton>
          </div>
        </form>
      </DrawerContent>
    </Drawer>
  );
}

function ManualMeter({ allocated, total }: { allocated: number | null; total: number }) {
  if (allocated === null) return <p className="footnote mt-2 px-2 text-negative">Use amounts like 250 or 249.50 (at most two decimals).</p>;
  const pct = total ? Math.min(100, (allocated / total) * 100) : 0;
  const done = total > 0 && allocated === total, over = allocated > total;
  return (
    <div className="mt-2.5 px-2">
      <div className="footnote flex justify-between">
        <span className="tabular text-muted-foreground">Allocated {inr(allocated)} of {inr(total)}</span>
        <span className={cn("font-semibold", done ? "text-positive" : over ? "text-negative" : "text-muted-foreground")}>{done ? "✓ Exact" : over ? inr(allocated - total) + " over" : inr(total - allocated) + " left"}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#141716]/[0.06]">
        <m.div className={cn("h-full rounded-full", done ? "bg-positive" : over ? "bg-negative" : "bg-tint")} animate={{ width: pct + "%" }} transition={{ duration: 0.25, ease: EASE }} />
      </div>
    </div>
  );
}
