import * as React from "react";
import { HeartHandshake } from "lucide-react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { haptic } from "@/components/app/bits";
import { useAskWaiver, useWaiveDebt } from "@/hooks/queries";
import { centsToInput, inr } from "@/lib/money";

// "No need to pay", from either side of a debt (all of it, or the amount
// entered):
//  - offer: the lender lets the other person off. A group admin approves it,
//    at once when the lender is an admin;
//  - ask: the debtor asks the other person to let them off. That person (or a
//    group admin) says yes or no.
// Once it counts, everyone in the group is told.
export function WaiveDebt({ groupId, mode, otherId, otherName, cents, isAdmin, onDone }: {
  groupId: string; mode: "offer" | "ask"; otherId: string; otherName: string; cents: number; isAdmin: boolean; onDone: () => void;
}) {
  const offer = useWaiveDebt(groupId), ask = useAskWaiver(groupId);
  const busy = offer.isPending || ask.isPending;
  const [open, setOpen] = React.useState(false);
  const amount = inr(cents);
  const copy = mode === "offer" ? {
    button: `No need to pay? Let ${otherName} off`,
    title: `Let ${otherName} off ${amount}?`,
    body: isAdmin
      ? `${otherName} won't need to pay it. You're a group admin, so it counts at once. Everyone in the group is told.`
      : `${otherName} won't need to pay it once a group admin approves. Then everyone in the group is told.`,
    action: isAdmin ? "Let off" : "Ask an admin",
  } : {
    button: `Can't pay? Ask ${otherName} to let you off`,
    title: `Ask ${otherName} to let you off ${amount}?`,
    body: `${otherName} (or a group admin) decides. If they say yes, you won't need to pay it and everyone in the group is told.`,
    action: "Ask",
  };
  const done = (title: string, description: string) => {
    haptic([10, 40, 14]);
    toast.success(title, { description });
    setOpen(false);
    onDone();
  };
  const confirm = (e: React.MouseEvent) => {
    e.preventDefault();
    const onError = (err: Error) => toast.error(err.message);
    if (mode === "ask") ask.mutate({ toMemberId: otherId, amount: centsToInput(cents) }, {
      onSuccess: () => done(`Asked ${otherName} to let you off ${amount}.`, "You still owe it until they say yes."),
      onError,
    });
    else offer.mutate({ fromMemberId: otherId, amount: centsToInput(cents) }, {
      onSuccess: res => res.status === "confirmed"
        ? done(`You let ${otherName} off ${amount}.`, "Everyone in the group has been told.")
        : done(`Sent to the group's admins: let ${otherName} off ${amount}.`, "It counts once an admin approves it. Then everyone in the group is told."),
      onError,
    });
  };
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} data-testid={mode === "offer" ? "waive-open" : "ask-waiver-open"}
        className="mx-auto mt-3 flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-2 text-center text-[14px] font-medium text-tint transition-transform active:scale-95">
        <HeartHandshake className="size-4 shrink-0" strokeWidth={2.2} />{copy.button}
      </button>
      <AlertDialog open={open} onOpenChange={o => { if (!busy) setOpen(o); }}>
        <AlertDialogContent className="max-w-[340px] rounded-[26px] border-0 p-6">
          <AlertDialogHeader className="text-left">
            <AlertDialogTitle className="title-2">{copy.title}</AlertDialogTitle>
            <AlertDialogDescription className="text-[14px]">{copy.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-2">
            <AlertDialogCancel disabled={busy} className="h-11 rounded-full border-0 bg-[#141716]/[0.06] shadow-none">Cancel</AlertDialogCancel>
            <AlertDialogAction data-testid="waive-confirm" className="h-11 rounded-full" disabled={busy} onClick={confirm}>
              {busy ? "Sending…" : copy.action}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
