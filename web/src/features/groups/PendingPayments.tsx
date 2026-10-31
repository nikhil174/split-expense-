import { AnimatePresence, m } from "motion/react";
import { Check, Hourglass, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EASE, LoadingButton, PersonAvatar, SectionTitle, haptic } from "@/components/app/bits";
import { glitterBurst } from "@/components/app/glitter";
import { useDecidePayment, usePendingPayments } from "@/hooks/queries";
import type { PendingPayment } from "@/lib/api";
import { inr } from "@/lib/money";
import { toast } from "sonner";
import * as React from "react";
import { AwaitingBadge, ProofDialog, proofSrc } from "./Awaiting";

// Payments only count once the person who received them confirms. This shows
// what is waiting on you (confirm/reject) and what you sent (cancel).
// With groupId it shows only that group.
export function PendingPayments({ groupId, className }: { groupId?: string; className?: string }) {
  const q = usePendingPayments();
  const decide = useDecidePayment();
  const only = (list: PendingPayment[] = []) => list.filter(x => !groupId || x.groupId === groupId);
  const toConfirm = only(q.data?.toConfirm), waiting = only(q.data?.waiting);
  const showGroup = !groupId;
  const busy = (id: string, action: string) => decide.isPending && decide.variables?.id === id && decide.variables.action === action;
  const act = (x: PendingPayment, action: "confirm" | "reject" | "cancel") => decide.mutate({ groupId: x.groupId, id: x.id, action }, {
    onSuccess: () => {
      if (action === "confirm") { haptic([10, 40, 14]); glitterBurst(); toast.success(`Confirmed ${inr(x.amountCents)} from ${x.fromName}.`); }
      else toast.success(action === "reject" ? `Rejected ${x.fromName}'s payment. It won't count.` : "Payment cancelled.");
    },
  });
  const [proof, setProof] = React.useState<PendingPayment | null>(null);
  if (!toConfirm.length && !waiting.length) return null;

  return (
    <section className={className} data-testid="pending-payments">
      {toConfirm.length > 0 && (
        <>
          <SectionTitle>{toConfirm.length === 1 ? "Confirm this payment" : `Confirm ${toConfirm.length} payments`}</SectionTitle>
          <div className="panel overflow-hidden [&>*:not(:last-child)]:border-b [&>*:not(:last-child)]:border-hairline">
            <AnimatePresence initial={false}>
              {toConfirm.map(x => (
                <m.div key={x.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.25, ease: EASE }} className="px-4 py-3.5">
                  <div className="flex items-center gap-3">
                    <PersonAvatar id={x.fromMemberId} name={x.fromName} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-medium">{x.fromName} says they paid you <span className="tabular text-positive">{inr(x.amountCents)}</span></p>
                      <p className="truncate text-[12.5px] text-muted-foreground">Did you receive it?{showGroup ? " · " + x.groupName : ""}</p>
                      <AwaitingBadge label="awaiting your approval" className="mt-1" />
                    </div>
                    {x.hasProof && (
                      <button type="button" aria-label={`View ${x.fromName}'s payment screenshot`} onClick={() => setProof(x)} className="relative size-12 shrink-0 cursor-pointer overflow-hidden rounded-[10px] bg-white ring-1 ring-[#141716]/[0.08] transition-transform active:scale-95">
                        <img src={proofSrc(x.groupId, x.id)} alt="" className="size-full object-cover" />
                        <span className="absolute inset-x-0 bottom-0 bg-black/55 py-0.5 text-center text-[9px] font-medium text-white">Proof</span>
                      </button>
                    )}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <LoadingButton variant="secondary" className="rounded-full" aria-label={`Reject ${inr(x.amountCents)} from ${x.fromName}`} loading={busy(x.id, "reject")} loadingText="Rejecting…" disabled={decide.isPending} onClick={() => act(x, "reject")}><X />Not received</LoadingButton>
                    <LoadingButton className="rounded-full" aria-label={`Confirm ${inr(x.amountCents)} from ${x.fromName}`} loading={busy(x.id, "confirm")} loadingText="Confirming…" disabled={decide.isPending} onClick={() => act(x, "confirm")}><Check />Confirm</LoadingButton>
                  </div>
                </m.div>
              ))}
            </AnimatePresence>
          </div>
        </>
      )}
      {waiting.length > 0 && (
        <div className={toConfirm.length ? "mt-4" : ""}>
          <SectionTitle>Waiting for confirmation</SectionTitle>
          <div className="panel overflow-hidden [&>*:not(:last-child)]:border-b [&>*:not(:last-child)]:border-hairline">
            {waiting.map(x => (
              <div key={x.id} className="flex items-center gap-3 px-4 py-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#141716]/[0.05] text-muted-foreground"><Hourglass className="size-[18px]" /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium">You paid {x.toName} <span className="tabular">{inr(x.amountCents)}</span></p>
                  <p className="truncate text-[12.5px] text-muted-foreground">Counts once {x.toName} approves{showGroup ? " · " + x.groupName : ""}</p>
                  <AwaitingBadge label="awaiting approval" className="mt-1" />
                </div>
                <Button variant="ghost" size="sm" className="rounded-full text-muted-foreground" aria-label={`Cancel ${inr(x.amountCents)} to ${x.toName}`} disabled={decide.isPending} onClick={() => act(x, "cancel")}>Cancel</Button>
              </div>
            ))}
          </div>
        </div>
      )}
      <ProofDialog src={proof ? proofSrc(proof.groupId, proof.id) : null} title={proof ? `${proof.fromName}'s payment` : ""} onClose={() => setProof(null)} />
    </section>
  );
}
