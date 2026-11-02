import { AnimatePresence, m } from "motion/react";
import { Check, Hourglass, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EASE, LoadingButton, PersonAvatar, SectionTitle, haptic } from "@/components/app/bits";
import { glitterBurst } from "@/components/app/glitter";
import { useDecidePayment, useMe, usePendingPayments } from "@/hooks/queries";
import type { PendingPayment } from "@/lib/api";
import { inr } from "@/lib/money";
import { toast } from "sonner";
import * as React from "react";
import { AwaitingBadge, ProofDialog, isAskedWaiver, isWaiver, proofSrc } from "./Awaiting";

// Payments only count once the person who received them confirms. This shows
// what is waiting on you (confirm/reject) and what you sent (cancel).
// Waivers ("no need to pay", the lender letting someone off) wait for an
// admin the same way; the debtor can't cancel one. With groupId it shows only
// that group; with withMemberId too, only what's between me and that person.
export function PendingPayments({ groupId, withMemberId, className }: { groupId?: string; withMemberId?: string; className?: string }) {
  const q = usePendingPayments();
  const meId = useMe().data?.user?.id;
  const decide = useDecidePayment();
  const only = (list: PendingPayment[] = []) => list.filter(x => (!groupId || x.groupId === groupId) && (!withMemberId || x.fromMemberId === withMemberId || x.toMemberId === withMemberId));
  const toConfirm = only(q.data?.toConfirm), waiting = only(q.data?.waiting);
  const showGroup = !groupId;
  const busy = (id: string, action: string) => decide.isPending && decide.variables?.id === id && decide.variables.action === action;
  const act = (x: PendingPayment, action: "confirm" | "reject" | "cancel") => decide.mutate({ groupId: x.groupId, id: x.id, action }, {
    onSuccess: () => {
      if (isWaiver(x)) {
        if (action === "confirm") { haptic([10, 40, 14]); toast.success(x.toMemberId === meId ? `You let ${x.fromName} off ${inr(x.amountCents)}.` : `Approved: ${x.fromName} doesn't need to pay ${x.toName} ${inr(x.amountCents)}.`, { description: "Everyone in the group has been told." }); }
        else toast.success(`${action === "reject" ? "Not approved" : "Cancelled"}. ${x.fromName} still owes it.`);
        return;
      }
      if (action === "confirm") { haptic([10, 40, 14]); glitterBurst(); toast.success(x.needsAdmin ? `Approved ${inr(x.amountCents)} from ${x.fromName} to ${x.toName}.` : `Confirmed ${inr(x.amountCents)} from ${x.fromName}.`); }
      else toast.success(action === "reject" ? (x.needsAdmin ? "Not approved. It won't count." : `Rejected ${x.fromName}'s payment. It won't count.`) : "Payment cancelled.");
    },
  });
  const [proof, setProof] = React.useState<PendingPayment | null>(null);
  if (!toConfirm.length && !waiting.length) return null;

  return (
    <section className={className} data-testid="pending-payments">
      {toConfirm.length > 0 && (
        <>
          <SectionTitle>{toConfirm.every(isAskedWaiver) ? (toConfirm.length === 1 ? "Asked to let them off" : `${toConfirm.length} asks to let them off`) : toConfirm.every(isWaiver) ? (toConfirm.length === 1 ? "Approve letting them off" : `Approve ${toConfirm.length} let-offs`) : toConfirm.length === 1 ? "Confirm this payment" : `Confirm ${toConfirm.length} payments`}</SectionTitle>
          <div className="panel overflow-hidden [&>*:not(:last-child)]:border-b [&>*:not(:last-child)]:border-hairline">
            <AnimatePresence initial={false}>
              {toConfirm.map(x => (
                <m.div key={x.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.25, ease: EASE }} className="px-4 py-3.5">
                  <div className="flex items-center gap-3">
                    <PersonAvatar id={x.fromMemberId} name={x.fromName} />
                    <div className="min-w-0 flex-1">
                      {isAskedWaiver(x) && x.toMemberId !== meId ? (
                        <>
                          <p className="text-[15px] leading-5 font-medium">{x.fromName} asks {x.toName} to let them off <span className="tabular text-positive">{inr(x.amountCents)}</span></p>
                          <p className="text-[12.5px] leading-[17px] text-muted-foreground">You're an admin, so you can decide for {x.toName}. Say yes and {x.fromName} won't need to pay it; everyone in the group is told.{showGroup ? " · " + x.groupName : ""}</p>
                        </>
                      ) : isAskedWaiver(x) ? (
                        <>
                          <p className="text-[15px] leading-5 font-medium">{x.fromName} asks you to let them off <span className="tabular text-positive">{inr(x.amountCents)}</span></p>
                          <p className="text-[12.5px] leading-[17px] text-muted-foreground">Say yes and they won't need to pay it. Everyone in the group is told.{showGroup ? " · " + x.groupName : ""}</p>
                        </>
                      ) : isWaiver(x) ? (
                        <>
                          <p className="text-[15px] leading-5 font-medium">{x.toName} wants to let {x.fromName} off <span className="tabular text-positive">{inr(x.amountCents)}</span></p>
                          <p className="text-[12.5px] leading-[17px] text-muted-foreground">You're an admin: approve it and {x.fromName} won't need to pay it. Everyone in the group is told.{showGroup ? " · " + x.groupName : ""}</p>
                        </>
                      ) : x.needsAdmin ? (
                        <>
                          <p className="text-[15px] leading-5 font-medium">{x.toName} says {x.fromName} paid them <span className="tabular text-positive">{inr(x.amountCents)}</span></p>
                          <p className="text-[12.5px] leading-[17px] text-muted-foreground">You're an admin: approve it if {x.fromName} really paid, then it counts.{showGroup ? " · " + x.groupName : ""}</p>
                        </>
                      ) : (
                        <>
                          <p className="truncate text-[15px] font-medium">{x.fromName} says they paid you <span className="tabular text-positive">{inr(x.amountCents)}</span></p>
                          <p className="truncate text-[12.5px] text-muted-foreground">Did you receive it?{showGroup ? " · " + x.groupName : ""}</p>
                        </>
                      )}
                      <AwaitingBadge label={x.needsAdmin || x.toMemberId !== meId ? "waiting for your approval (admin)" : isWaiver(x) ? "waiting for your answer" : "waiting for you to confirm"} className="mt-1" />
                    </div>
                    {x.hasProof && (
                      <button type="button" aria-label={`View ${x.fromName}'s payment screenshot`} onClick={() => setProof(x)} className="relative size-12 shrink-0 cursor-pointer overflow-hidden rounded-[10px] bg-white ring-1 ring-[#141716]/[0.08] transition-transform active:scale-95">
                        <img src={proofSrc(x.groupId, x.id)} alt="" className="size-full object-cover" />
                        <span className="absolute inset-x-0 bottom-0 bg-black/55 py-0.5 text-center text-[9px] font-medium text-white">Proof</span>
                      </button>
                    )}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <LoadingButton variant="secondary" className="rounded-full" aria-label={`Reject ${inr(x.amountCents)} from ${x.fromName}`} loading={busy(x.id, "reject")} loadingText="Rejecting…" disabled={decide.isPending} onClick={() => act(x, "reject")}><X />{x.needsAdmin ? "Reject" : isWaiver(x) ? "Say no" : "Not received"}</LoadingButton>
                    <LoadingButton className="rounded-full" aria-label={`Confirm ${inr(x.amountCents)} from ${x.fromName}`} loading={busy(x.id, "confirm")} loadingText="Confirming…" disabled={decide.isPending} onClick={() => act(x, "confirm")}><Check />{x.needsAdmin ? "Approve" : isWaiver(x) ? "Let off" : "Confirm"}</LoadingButton>
                  </div>
                </m.div>
              ))}
            </AnimatePresence>
          </div>
        </>
      )}
      {waiting.length > 0 && (
        <div className={toConfirm.length ? "mt-4" : ""}>
          <SectionTitle>{waiting.every(x => x.needsAdmin) ? "Waiting for admin approval" : "Waiting for approval"}</SectionTitle>
          <div className="panel overflow-hidden [&>*:not(:last-child)]:border-b [&>*:not(:last-child)]:border-hairline">
            {waiting.map(x => {
              const iRecordedIt = x.needsAdmin && x.toMemberId === meId;
              // The debtor can withdraw their own request, but not cancel the lender's offer.
              const canCancel = !isWaiver(x) || x.toMemberId === meId || isAskedWaiver(x);
              return (
                <div key={x.id} className="flex items-center gap-3 px-4 py-3" data-testid="waiting-payment">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#141716]/[0.05] text-muted-foreground"><Hourglass className="size-[18px]" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] leading-5 font-medium">
                      {isAskedWaiver(x) ? <>You asked {x.toName} to let you off <span className="tabular">{inr(x.amountCents)}</span></>
                        : isWaiver(x) ? (x.toMemberId === meId ? <>You're letting {x.fromName} off <span className="tabular">{inr(x.amountCents)}</span></> : <>{x.toName} is letting you off <span className="tabular">{inr(x.amountCents)}</span></>)
                        : iRecordedIt ? <>You recorded: {x.fromName} paid you <span className="tabular">{inr(x.amountCents)}</span></>
                        : x.needsAdmin ? <>{x.toName} recorded that you paid them <span className="tabular">{inr(x.amountCents)}</span></>
                        : <>You paid {x.toName} <span className="tabular">{inr(x.amountCents)}</span></>}
                    </p>
                    <p className="mt-0.5 text-[12.5px] leading-[17px] text-muted-foreground">
                      {isAskedWaiver(x)
                        ? <>Waiting for <b className="font-medium text-foreground">{x.toName}</b> (or a group admin) to say yes or no. Until then you still owe it.</>
                        : isWaiver(x)
                        ? <>Waiting for <b className="font-medium text-foreground">an admin</b> to approve it. Until then {x.toMemberId === meId ? `${x.fromName} still owes it` : "you still owe it"}.</>
                        : x.needsAdmin
                        ? <>Waiting for <b className="font-medium text-foreground">an admin</b> to approve it. It isn't counted until then.</>
                        : <>Waiting for <b className="font-medium text-foreground">{x.toName}</b> to confirm they got the money. It isn't counted until then.</>}
                      {showGroup ? " · " + x.groupName : ""}
                    </p>
                    <AwaitingBadge label={x.needsAdmin ? "waiting for admin approval" : isWaiver(x) ? `waiting for ${x.toName} to answer` : `waiting for ${x.toName} to confirm`} className="mt-1" />
                  </div>
                  {canCancel && <Button variant="ghost" size="sm" className="rounded-full text-muted-foreground" aria-label={iRecordedIt ? `Cancel ${inr(x.amountCents)} from ${x.fromName}` : `Cancel ${inr(x.amountCents)} to ${x.toName}`} disabled={decide.isPending} onClick={() => act(x, "cancel")}>Cancel</Button>}
                </div>
              );
            })}
          </div>
        </div>
      )}
      <ProofDialog src={proof ? proofSrc(proof.groupId, proof.id) : null} title={proof ? `${proof.fromName}'s payment` : ""} onClose={() => setProof(null)} />
    </section>
  );
}
