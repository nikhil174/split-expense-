import * as React from "react";
import { AnimatePresence, m } from "motion/react";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EASE, LoadingButton, NativeSelect, PersonAvatar, Segmented, fieldClass, haptic } from "@/components/app/bits";
import { useAddExpense, useGroup, type NewExpense } from "@/hooks/queries";
import { inr, toCents } from "@/lib/money";
import { cn } from "@/lib/utils";

type Mode = "equal" | "manual";

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
    setPaidBy(members.some(m => m.id === meId) ? meId! : members[0]?.id || "");
    setSelected(new Set(members.map(m => m.id)));
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
      onSuccess: () => { haptic(); toast.success(`“${body.description}” added · ${inr(total)}`); onOpenChange(false); },
      onError: err => setError(err.message),
    });
  };

  return (
    <Drawer open={open} onOpenChange={o => { if (!add.isPending) onOpenChange(o); }} repositionInputs={false}>
      <DrawerContent className="mx-auto max-h-[94dvh] max-w-xl rounded-t-[28px] border-hairline">
        <DrawerHeader className="px-5 pt-4 pb-3 text-left">
          <DrawerTitle className="font-serif text-[30px] leading-none font-normal tracking-[-0.02em]">Add expense</DrawerTitle>
          <DrawerDescription className="text-[13px]">Everyone in the split owes their share to whoever paid.</DrawerDescription>
        </DrawerHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 pb-5">
            <div className="space-y-1.5">
              <Label htmlFor="exp-desc">Description</Label>
              <Input id="exp-desc" required maxLength={160} autoComplete="off" placeholder="Dinner, cab, groceries…" value={description} onChange={e => setDescription(e.target.value)} className={fieldClass} />
            </div>
            <div className="grid grid-cols-[1.1fr_1fr] gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="exp-amount">Total</Label>
                <div className="flex h-12 items-center rounded-xl border border-input bg-surface px-4 transition-[border-color,box-shadow] focus-within:border-brass/70 focus-within:ring-[3px] focus-within:ring-brass/15">
                  <span className="mr-1 font-serif text-xl text-muted-foreground">₹</span>
                  <input id="exp-amount" required inputMode="decimal" type="number" min="0.01" step="0.01" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} className="tabular h-full w-full min-w-0 bg-transparent font-serif text-[24px] outline-none" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="exp-paid-by">Paid by</Label>
                <NativeSelect id="exp-paid-by" value={paidBy} onChange={e => setPaidBy(e.target.value)}>
                  {members.map(m => <option key={m.id} value={m.id}>{label(m.id, m.name)}</option>)}
                </NativeSelect>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Split</Label>
                {mode === "equal" && <button type="button" className="cursor-pointer text-[12.5px] font-medium text-brass" onClick={() => setSelected(n === members.length ? new Set() : new Set(members.map(m => m.id)))}>{n === members.length ? "Clear all" : "Select all"}</button>}
              </div>
              <Segmented id="split-mode" value={mode} onChange={setMode} options={[{ value: "equal", label: "Equally" }, { value: "manual", label: "Exact amounts" }]} />
              <AnimatePresence mode="wait" initial={false}>
                {mode === "equal" ? (
                  <m.div key="equal" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18, ease: EASE }}>
                    <div className="flex flex-wrap gap-2">
                      {members.map(m => {
                        const on = selected.has(m.id);
                        return (
                          <button key={m.id} type="button" role="checkbox" aria-checked={on} onClick={() => toggle(m.id)}
                            className={cn("flex cursor-pointer items-center gap-2 rounded-full border py-1 pr-3 pl-1 text-sm font-medium transition-all active:scale-95",
                              on ? "border-brass/50 bg-brass-soft text-foreground" : "border-border bg-transparent text-muted-foreground")}>
                            <span className="relative"><PersonAvatar id={m.id} name={m.name} size="sm" className={cn("transition-opacity", !on && "opacity-40")} />
                              {on && <span className="absolute -right-0.5 -bottom-0.5 grid size-4 place-items-center rounded-full bg-brass text-background ring-2 ring-card"><Check className="size-2.5" strokeWidth={3.5} /></span>}
                            </span>
                            {label(m.id, m.name)}
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-3 text-sm text-muted-foreground">
                      {!n ? "Choose at least one person." : total ? <><span className="tabular font-medium text-foreground">{inr(Math.floor(total / n))}{total % n ? "–" + inr(Math.ceil(total / n)) : ""}</span> each · {n} {n === 1 ? "person" : "people"}</> : `${n} ${n === 1 ? "person" : "people"} selected`}
                    </p>
                  </m.div>
                ) : (
                  <m.div key="manual" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18, ease: EASE }} className="space-y-2">
                    {members.map(m => (
                      <div key={m.id} className="flex items-center gap-3">
                        <PersonAvatar id={m.id} name={m.name} size="sm" />
                        <label htmlFor={"manual-" + m.id} className="min-w-0 flex-1 truncate text-sm font-medium">{label(m.id, m.name)}</label>
                        <div className="flex h-11 w-32 items-center rounded-xl border border-input bg-surface px-3 transition-[border-color,box-shadow] focus-within:border-brass/70 focus-within:ring-[3px] focus-within:ring-brass/15">
                          <span className="mr-1 text-muted-foreground">₹</span>
                          <input id={"manual-" + m.id} aria-label={"Exact share for " + m.name} inputMode="decimal" type="number" min="0" step="0.01" placeholder="0.00"
                            value={manual[m.id] || ""} onChange={e => setManual(v => ({ ...v, [m.id]: e.target.value }))} className="tabular w-full min-w-0 bg-transparent text-right outline-none" />
                        </div>
                      </div>
                    ))}
                    <ManualMeter allocated={manualInvalid ? null : allocated} total={total || 0} />
                  </m.div>
                )}
              </AnimatePresence>
            </div>
            <AnimatePresence>{error && <m.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} role="alert" className="rounded-xl bg-negative-soft px-3 py-2.5 text-sm font-medium text-negative">{error}</m.p>}</AnimatePresence>
          </div>
          <div className="safe-bottom border-t border-hairline bg-card/95 px-5 pt-3 backdrop-blur-xl">
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
  if (allocated === null) return <p className="text-sm font-medium text-negative">Use amounts like 250 or 249.50 (at most two decimals).</p>;
  const pct = total ? Math.min(100, (allocated / total) * 100) : 0;
  const done = total > 0 && allocated === total, over = allocated > total;
  return (
    <div className="rounded-xl bg-muted/60 p-3.5 ring-1 ring-hairline ring-inset">
      <div className="flex justify-between text-sm">
        <span className="tabular">Allocated <b>{inr(allocated)}</b> of {inr(total)}</span>
        <span className={cn("font-medium", done ? "text-positive" : over ? "text-negative" : "text-muted-foreground")}>{done ? "✓ Exact" : over ? inr(allocated - total) + " over" : inr(total - allocated) + " left"}</span>
      </div>
      <div className="mt-2.5 h-[3px] overflow-hidden rounded-full bg-background">
        <m.div className={cn("h-full rounded-full", done ? "bg-positive" : over ? "bg-negative" : "bg-brass")} animate={{ width: pct + "%" }} transition={{ duration: 0.3, ease: EASE }} />
      </div>
    </div>
  );
}
