import * as React from "react";
import { Check, Pencil, X } from "lucide-react";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { List, LoadingButton, PersonAvatar, rowClass } from "@/components/app/bits";
import { SheetHeader } from "./AddExpenseDrawer";
import { useAdminAction, useGroup } from "@/hooks/queries";
import { post } from "@/lib/api";
import { cn } from "@/lib/utils";

// Everyone in the group. The admin can rename a member right here: the new
// name shows on all their past expenses and payments (history is stored by
// id) and is the name they sign in with from now on.
export function MembersSheet({ groupId, open, onOpenChange }: { groupId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const group = useGroup(groupId);
  const members = group.data?.members || [];
  const me = group.data?.me;
  const [editing, setEditing] = React.useState<string | null>(null);
  const [name, setName] = React.useState("");
  // The admin renames anyone; a member renames only themselves.
  const rename = useAdminAction((v: { id: string; name: string }) => v.id === me?.id && !me?.isAdmin ? post("/api/me/name", { name: v.name }) : post(`/api/admin/requests/${v.id}/rename`, { name: v.name }), v => `Renamed to “${v.name}”.`);
  React.useEffect(() => { if (!open) setEditing(null); }, [open]);

  const start = (id: string, current: string) => { setEditing(id); setName(current); };
  const clean = name.trim().replace(/\s+/g, " ");
  const current = members.find(mm => mm.id === editing);
  const ok = !!current && clean.length >= 2 && clean.length <= 60 && clean !== current.name;
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (ok && editing) rename.mutate({ id: editing, name: clean }, { onSuccess: () => setEditing(null) });
  };

  return (
    <Drawer open={open} onOpenChange={o => { if (!rename.isPending) onOpenChange(o); }} repositionInputs={false}>
      <DrawerContent className="mx-auto max-h-[90dvh] max-w-xl rounded-t-[28px] border-0">
        <SheetHeader title={`${members.length} ${members.length === 1 ? "member" : "members"}`}
          description={me?.isAdmin ? "Tap Edit to rename someone. Their new name shows on all past expenses." : "Everyone in this group. Tap Edit on your own name to change it."} disabled={rename.isPending} />
        <div className="safe-bottom min-h-0 overflow-y-auto px-4 pt-1 pb-6">
          <List inset={60}>
            {members.map(mm => {
              const isMe = mm.id === me?.id, canRename = me?.isAdmin ? mm.id !== "admin" : isMe;
              return editing === mm.id ? (
                <form key={mm.id} onSubmit={save} className={cn(rowClass, "gap-2")}>
                  <PersonAvatar id={mm.id} name={clean || mm.name} size="sm" />
                  <Input aria-label={"New name for " + mm.name} autoFocus required minLength={2} maxLength={60} value={name} onChange={e => setName(e.target.value)}
                    className="h-10 min-w-0 flex-1 rounded-[12px] border-[#141716]/[0.1] bg-white px-3 text-[15px]" />
                  <button type="button" aria-label="Cancel" disabled={rename.isPending} onClick={() => setEditing(null)} className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-full bg-[#141716]/[0.06] transition-transform active:scale-90 disabled:opacity-40"><X className="size-4" strokeWidth={2.4} /></button>
                  <LoadingButton type="submit" size="icon" aria-label="Save name" disabled={!ok} loading={rename.isPending} className="size-9 shrink-0 rounded-full"><Check className="size-4" strokeWidth={2.6} /></LoadingButton>
                </form>
              ) : (
                <div key={mm.id} className={rowClass}>
                  <PersonAvatar id={mm.id} name={mm.name} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium">{mm.name}{isMe && <span className="font-normal text-muted-foreground"> (you)</span>}</span>
                    <span className="block text-[12.5px] text-muted-foreground">{mm.id === "admin" ? "Admin" : mm.status === "pending" ? "Waiting for approval" : "Member"}</span>
                  </span>
                  {canRename && (
                    <button type="button" aria-label={"Rename " + mm.name} onClick={() => start(mm.id, mm.name)}
                      className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-[#141716]/[0.05] py-1.5 pr-3 pl-2.5 text-[13.5px] font-medium transition-transform active:scale-95">
                      <Pencil className="size-3.5" />Edit
                    </button>
                  )}
                </div>
              );
            })}
          </List>
          {me?.isAdmin && <p className="footnote mt-3 px-2 text-muted-foreground">Renamed members sign in with their new name. To remove someone or reset their PIN, use Admin → Requests.</p>}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
