import * as React from "react";
import { HeartHandshake } from "lucide-react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { haptic } from "@/components/app/bits";
import { useWaiveDebt } from "@/hooks/queries";
import { centsToInput, inr } from "@/lib/money";

// "No need to pay": the lender lets someone off what they still owe them
// (all of it, or the amount entered). A group admin approves it, at once when
// the lender is an admin, and then everyone in the group is told.
export function WaiveDebt({ groupId, fromMemberId, fromName, cents, isAdmin, onDone }: {
  groupId: string; fromMemberId: string; fromName: string; cents: number; isAdmin: boolean; onDone: () => void;
}) {
  const waive = useWaiveDebt(groupId);
  const [open, setOpen] = React.useState(false);
  const amount = inr(cents);
  const confirm = (e: React.MouseEvent) => {
    e.preventDefault();
    waive.mutate({ fromMemberId, amount: centsToInput(cents) }, {
      onSuccess: res => {
        haptic([10, 40, 14]);
        if (res.status === "confirmed") toast.success(`You let ${fromName} off ${amount}.`, { description: "Everyone in the group has been told." });
        else toast.success(`Sent to the group's admins: let ${fromName} off ${amount}.`, { description: "It counts once an admin approves it. Then everyone in the group is told." });
        setOpen(false);
        onDone();
      },
      onError: err => toast.error(err.message),
    });
  };
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} data-testid="waive-open"
        className="mx-auto mt-3 flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-2 text-[14px] font-medium text-tint transition-transform active:scale-95">
        <HeartHandshake className="size-4" strokeWidth={2.2} />No need to pay? Let {fromName} off
      </button>
      <AlertDialog open={open} onOpenChange={o => { if (!waive.isPending) setOpen(o); }}>
        <AlertDialogContent className="max-w-[340px] rounded-[26px] border-0 p-6">
          <AlertDialogHeader className="text-left">
            <AlertDialogTitle className="title-2">Let {fromName} off {amount}?</AlertDialogTitle>
            <AlertDialogDescription className="text-[14px]">
              {isAdmin
                ? `${fromName} won't need to pay it. You're a group admin, so it counts at once. Everyone in the group is told.`
                : `${fromName} won't need to pay it once a group admin approves. Then everyone in the group is told.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-2">
            <AlertDialogCancel disabled={waive.isPending} className="h-11 rounded-full border-0 bg-[#141716]/[0.06] shadow-none">Cancel</AlertDialogCancel>
            <AlertDialogAction data-testid="waive-confirm" className="h-11 rounded-full" disabled={waive.isPending} onClick={confirm}>
              {waive.isPending ? "Sending…" : isAdmin ? "Let off" : "Ask an admin"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
