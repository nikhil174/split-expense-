import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { LoadingButton, fieldClass } from "@/components/app/bits";
import { post } from "@/lib/api";
import { cn } from "@/lib/utils";

// A member changes their own name. It changes everywhere, including the name
// they sign in with, so the dialog says so.
export function ChangeNameDialog({ open, onClose, current }: { open: boolean; onClose: () => void; current: string }) {
  const qc = useQueryClient();
  const [name, setName] = React.useState(current);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  React.useEffect(() => { if (open) { setName(current); setError(""); } }, [open, current]);
  const clean = name.trim().replace(/\s+/g, " ");
  const ok = clean.length >= 2 && clean.length <= 60 && clean !== current;
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ok) return;
    setBusy(true); setError("");
    try {
      await post("/api/me/name", { name: clean });
      await qc.invalidateQueries();
      toast.success(`You're now “${clean}”.`, { description: "Sign in with this name from now on." });
      onClose();
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <AlertDialog open={open} onOpenChange={o => { if (!o && !busy) onClose(); }}>
      <AlertDialogContent className="max-w-[360px] rounded-[26px] border-0 p-6">
        <form onSubmit={save} className="space-y-4">
          <AlertDialogHeader>
            <AlertDialogTitle className="title-2">Change your name</AlertDialogTitle>
            <AlertDialogDescription>Your new name shows on all your past expenses and payments, and you sign in with it from now on.</AlertDialogDescription>
          </AlertDialogHeader>
          <Input aria-label="Your name" autoFocus required minLength={2} maxLength={60} value={name} onChange={e => { setName(e.target.value); setError(""); }} className={cn(fieldClass, "h-11")} />
          {error && <p role="alert" className="text-[13.5px] text-negative">{error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel type="button" disabled={busy} className="rounded-full border-0 bg-[#141716]/[0.06] shadow-none">Cancel</AlertDialogCancel>
            <LoadingButton type="submit" disabled={!ok} loading={busy} loadingText="Saving…">Save name</LoadingButton>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
