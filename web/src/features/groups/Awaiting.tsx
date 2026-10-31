import { Hourglass } from "lucide-react";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { inr } from "@/lib/money";
import { cn } from "@/lib/utils";

// "⏳ ₹20 awaiting approval": a payment recorded but not yet approved by the
// person who received it, so it doesn't count yet.
export function AwaitingBadge({ cents, label = "awaiting approval", className }: { cents?: number; label?: string; className?: string }) {
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1 rounded-full bg-[#e4c06c]/25 px-2 py-0.5 text-[12px] font-medium text-[#7a5a14]", className)}>
      <Hourglass className="size-3 shrink-0" strokeWidth={2.4} />
      <span className="truncate">{cents ? `${inr(cents)} ${label}` : label}</span>
    </span>
  );
}

export const proofSrc = (groupId: string, settlementId: string) => `/api/groups/${encodeURIComponent(groupId)}/settlements/${encodeURIComponent(settlementId)}/proof`;

// Full-size view of a payment screenshot.
export function ProofDialog({ src, title, onClose }: { src: string | null; title: string; onClose: () => void }) {
  return (
    <AlertDialog open={!!src} onOpenChange={o => { if (!o) onClose(); }}>
      <AlertDialogContent className="max-w-[380px] rounded-[26px] border-0 p-5">
        <AlertDialogHeader>
          <AlertDialogTitle className="title-2">{title}</AlertDialogTitle>
          <AlertDialogDescription>Check it against your bank or UPI app before approving.</AlertDialogDescription>
        </AlertDialogHeader>
        {src && <img src={src} alt="Payment screenshot" className="max-h-[60dvh] w-full rounded-[14px] bg-white object-contain ring-1 ring-[#141716]/[0.06]" />}
        <AlertDialogCancel variant="default" className="h-11 w-full rounded-full text-[15px]">Close</AlertDialogCancel>
      </AlertDialogContent>
    </AlertDialog>
  );
}
