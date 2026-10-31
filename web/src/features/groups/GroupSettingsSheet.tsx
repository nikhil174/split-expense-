import * as React from "react";
import { toast } from "sonner";
import { KeyRound, Pencil, Trash2 } from "lucide-react";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { LoadingButton, SectionTitle, fieldClass } from "@/components/app/bits";
import { PinInput } from "@/components/app/secrets";
import { SheetHeader } from "./AddExpenseDrawer";
import { useAccountAction } from "@/hooks/queries";
import { post, type GroupSummary } from "@/lib/api";

// A group's settings, for its admins, opened from the ⚙ on Home's group list:
// rename it, set or change its PIN, delete it. (If the group is locked on
// this phone, the server asks for its PIN first.)
export function GroupSettingsSheet({ group, onOpenChange }: { group: GroupSummary | null; onOpenChange: (o: boolean) => void }) {
  const [shown, setShown] = React.useState<GroupSummary | null>(group);
  React.useEffect(() => { if (group) setShown(group); }, [group]);
  const g = group || shown;
  const G = `/api/groups/${g?.id}`;
  const act = useAccountAction((v: { path: string; body?: unknown; done: string }) => post(G + v.path, v.body ?? {}), v => v.done);
  const [name, setName] = React.useState("");
  const [pins, setPins] = React.useState({ a: "", b: "" });
  const [deleting, setDeleting] = React.useState(false);
  React.useEffect(() => { if (group) { setName(group.name); setPins({ a: "", b: "" }); } }, [group]);
  if (!g) return null;
  const clean = name.trim().replace(/\s+/g, " ");
  return (
    <Drawer open={!!group} onOpenChange={o => { if (!act.isPending) onOpenChange(o); }} repositionInputs={false}>
      <DrawerContent className="mx-auto max-h-[90dvh] max-w-xl rounded-t-[28px] border-0">
        <SheetHeader title="Group settings" description={g.name} disabled={act.isPending} />
        <div className="safe-bottom min-h-0 space-y-6 overflow-y-auto px-4 pt-1 pb-6" data-testid="group-settings">
          <section>
            <SectionTitle>Name</SectionTitle>
            <form className="panel flex gap-2 p-3" onSubmit={e => { e.preventDefault(); if (clean.length >= 2 && clean !== g.name) act.mutate({ path: "/rename", body: { name: clean }, done: `Renamed to “${clean}”.` }); }}>
              <Input aria-label="Group name" required minLength={2} maxLength={80} value={name} onChange={e => setName(e.target.value)} className={fieldClass + " h-11 min-w-0 flex-1"} />
              <LoadingButton type="submit" className="h-11 shrink-0 rounded-full px-4" disabled={clean.length < 2 || clean === g.name} loading={act.isPending && act.variables?.path === "/rename"} loadingText="Saving…"><Pencil className="size-4" />Rename</LoadingButton>
            </form>
          </section>

          <section>
            <SectionTitle action={!g.hasPin ? <span className="rounded-full bg-[#e4c06c]/25 px-2 py-0.5 text-[12px] font-medium text-[#8a6416]">Not set</span> : undefined}>Group PIN</SectionTitle>
            <form className="panel space-y-3 p-4" onSubmit={e => { e.preventDefault(); if (pins.a !== pins.b) { toast.error("The two PINs don't match."); return; } act.mutate({ path: "/pin", body: { pin: pins.a }, done: "Group PIN saved. Share it with the members." }, { onSuccess: () => setPins({ a: "", b: "" }) }); }}>
              <p className="flex gap-2 text-[13.5px] text-muted-foreground"><KeyRound className="mt-0.5 size-4 shrink-0" />Members need it to join and to open the group (remembered for a day on each phone). When you change it, everyone else enters the new one and gets a notification.</p>
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1.5"><span className="eyebrow block px-1">{g.hasPin ? "New PIN" : "PIN"}</span><PinInput id="settings-pin" value={pins.a} onChange={v => setPins(x => ({ ...x, a: v }))} autoComplete="off" /></label>
                <label className="space-y-1.5"><span className="eyebrow block px-1">Confirm</span><PinInput id="settings-pin2" value={pins.b} onChange={v => setPins(x => ({ ...x, b: v }))} autoComplete="off" /></label>
              </div>
              <LoadingButton type="submit" variant="secondary" className="w-full rounded-full" disabled={pins.a.length !== 4 || pins.b.length !== 4} loading={act.isPending && act.variables?.path === "/pin"} loadingText="Saving…">{g.hasPin ? "Change PIN" : "Set PIN"}</LoadingButton>
            </form>
          </section>

          <section>
            <SectionTitle>Danger zone</SectionTitle>
            <button type="button" onClick={() => setDeleting(true)} className="panel flex w-full cursor-pointer items-center gap-3 p-4 text-left text-[15px] font-medium text-negative transition-transform active:scale-[0.98]"><Trash2 className="size-[18px]" />Delete group</button>
          </section>
        </div>
        <AlertDialog open={deleting} onOpenChange={o => { if (!act.isPending) setDeleting(o); }}>
          <AlertDialogContent className="max-w-[360px] rounded-[26px] border-0 p-6">
            <AlertDialogHeader>
              <AlertDialogTitle className="title-2">Delete “{g.name}”?</AlertDialogTitle>
              <AlertDialogDescription>This deletes the group with all its expenses and payments, for everyone. It can't be undone.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={act.isPending} className="rounded-full border-0 bg-[#141716]/[0.06] shadow-none">Cancel</AlertDialogCancel>
              <LoadingButton variant="destructive" loading={act.isPending} loadingText="Deleting…" onClick={() => act.mutate({ path: "/delete", done: "Group deleted." }, { onSuccess: () => { setDeleting(false); onOpenChange(false); } })}>Delete group</LoadingButton>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DrawerContent>
    </Drawer>
  );
}
