import * as React from "react";
import { toast } from "sonner";
import { Check, Clock3, KeyRound, LogOut, MoreHorizontal, Pencil, ShieldCheck, Trash2, UserMinus, UserPlus, X } from "lucide-react";
import { PinInput } from "@/components/app/secrets";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { List, LoadingButton, PersonAvatar, SectionTitle, fieldClass, rowClass } from "@/components/app/bits";
import { SheetHeader } from "./AddExpenseDrawer";
import { useAccountAction, useFriends, useGroup } from "@/hooks/queries";
import { InviteLinkCard } from "@/features/invites/Qr";
import { post, type Member } from "@/lib/api";
import { navigate } from "@/lib/route";
import { cn } from "@/lib/utils";

type Confirm = { title: string; body: string; action: string; run: () => Promise<unknown>; after?: () => void };

// Everyone in the group, with who is admin. Admins invite people by username
// or email, let in people waiting, make others admin, remove people, and
// rename or delete the group. Anyone can leave.
export function MembersSheet({ groupId, open, onOpenChange }: { groupId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const group = useGroup(groupId);
  const members = group.data?.members || [], waiting = group.data?.waiting || [];
  const me = group.data?.me, isAdmin = !!me?.isAdmin;
  const G = `/api/groups/${groupId}`;
  const act = useAccountAction((v: { path: string; body?: unknown; done?: string }) => post(G + v.path, v.body ?? {}), v => v.done || "Done.");
  const [confirm, setConfirm] = React.useState<Confirm | null>(null);
  const [renaming, setRenaming] = React.useState(false);
  // Setting or changing the group's PIN (admins).
  const [pinOpen, setPinOpen] = React.useState(false);
  const [pins, setPins] = React.useState({ a: "", b: "" });
  const [groupName, setGroupName] = React.useState("");
  const adminCount = members.filter(m => m.role === "admin").length;
  // Admins first, then by name; you are marked "(you)".
  const sorted = [...members].sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === "admin" ? -1 : 1));

  return (
    <Drawer open={open} onOpenChange={o => { if (!act.isPending) onOpenChange(o); }} repositionInputs={false}>
      <DrawerContent className="mx-auto max-h-[90dvh] max-w-xl rounded-t-[28px] border-0">
        <SheetHeader title={`${members.length} ${members.length === 1 ? "member" : "members"}`}
          description={isAdmin ? "You're an admin: invite people, let them in and manage the group." : "Everyone in this group. Admins manage who's in it."} disabled={act.isPending} />
        <div className="safe-bottom min-h-0 space-y-6 overflow-y-auto px-4 pt-1 pb-6">
          <InviteForm groupId={groupId} isAdmin={isAdmin} taken={new Set([...members, ...waiting].map(x => x.id))} />
          <InviteLinkCard groupId={groupId} groupName={group.data?.group.name || "the group"} />

          {isAdmin && waiting.length > 0 && (
            <section data-testid="waiting">
              <SectionTitle>Waiting</SectionTitle>
              <List inset={60}>
                {waiting.map(w => (
                  <div key={w.id} className={rowClass}>
                    <PersonAvatar id={w.id} name={w.name} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium">{w.name}</span>
                      <span className="flex items-center gap-1 text-[12.5px] text-muted-foreground"><Clock3 className="size-3" />{w.status === "invited" ? "Invited, hasn't answered" : w.status === "suggested" ? `Suggested by ${w.invitedBy || "a member"}` : "Asked to join"}{w.username ? " · @" + w.username : ""}</span>
                    </span>
                    {w.status === "pending" || w.status === "suggested" ? (
                      <span className="flex gap-1.5">
                        <button type="button" aria-label={"Turn away " + w.name} disabled={act.isPending} onClick={() => act.mutate({ path: `/members/${w.id}/reject`, done: `${w.name} was turned away.` })} className="grid size-9 cursor-pointer place-items-center rounded-full bg-[#141716]/[0.06] transition-transform active:scale-90"><X className="size-4" strokeWidth={2.4} /></button>
                        <button type="button" aria-label={"Let in " + w.name} disabled={act.isPending} onClick={() => act.mutate({ path: `/members/${w.id}/approve`, done: `${w.name} is in.` })} className="grid size-9 cursor-pointer place-items-center rounded-full bg-[#141716] text-white transition-transform active:scale-90"><Check className="size-4" strokeWidth={2.6} /></button>
                      </span>
                    ) : (
                      <button type="button" disabled={act.isPending} onClick={() => act.mutate({ path: `/members/${w.id}/cancel-invite`, done: "Invitation cancelled." })} className="cursor-pointer rounded-full bg-[#141716]/[0.05] px-3 py-1.5 text-[13px] font-medium transition-transform active:scale-95">Cancel</button>
                    )}
                  </div>
                ))}
              </List>
            </section>
          )}

          <section>
            {isAdmin && <SectionTitle>In the group</SectionTitle>}
            <List inset={60}>
              {sorted.map(mm => <MemberRow key={mm.id} m={mm} isMe={mm.id === me?.id} isAdmin={isAdmin} lastAdmin={mm.role === "admin" && adminCount <= 1} busy={act.isPending}
                onAction={(path, done) => act.mutate({ path, done })}
                onRemove={() => setConfirm({ title: `Remove ${mm.name}?`, body: "They leave the group. Their past expenses and payments stay, and any balance with them can still be settled.", action: "Remove", run: () => act.mutateAsync({ path: `/members/${mm.id}/remove`, done: `${mm.name} was removed.` }) })} />)}
            </List>
          </section>

          <section>
            <SectionTitle>Group</SectionTitle>
            <List inset={16}>
              {isAdmin && (renaming ? (
                <form className={cn(rowClass, "gap-2")} onSubmit={e => { e.preventDefault(); const n = groupName.trim(); if (n.length >= 2) act.mutate({ path: "/rename", body: { name: n }, done: `Renamed to “${n}”.` }, { onSuccess: () => setRenaming(false) }); }}>
                  <Input aria-label="Group name" autoFocus required minLength={2} maxLength={80} value={groupName} onChange={e => setGroupName(e.target.value)} className="h-10 min-w-0 flex-1 rounded-[12px] border-[#141716]/[0.1] bg-white px-3 text-[15px]" />
                  <button type="button" aria-label="Cancel" onClick={() => setRenaming(false)} className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-full bg-[#141716]/[0.06]"><X className="size-4" strokeWidth={2.4} /></button>
                  <LoadingButton type="submit" size="icon" aria-label="Save group name" loading={act.isPending} className="size-9 shrink-0 rounded-full"><Check className="size-4" strokeWidth={2.6} /></LoadingButton>
                </form>
              ) : (
                <button type="button" onClick={() => { setGroupName(group.data?.group.name || ""); setRenaming(true); }} className={cn(rowClass, "cursor-pointer gap-3 text-[15px]")}><Pencil className="size-[18px] text-muted-foreground" />Rename group</button>
              ))}
              {isAdmin && (
                <button type="button" onClick={() => { setPins({ a: "", b: "" }); setPinOpen(true); }} className={cn(rowClass, "cursor-pointer gap-3 text-[15px]")}>
                  <KeyRound className="size-[18px] text-muted-foreground" />
                  <span className="flex-1 text-left">{group.data?.group.hasPin ? "Change group PIN" : "Set a group PIN"}</span>
                  {!group.data?.group.hasPin && <span className="rounded-full bg-[#e4c06c]/25 px-2 py-0.5 text-[12px] font-medium text-[#8a6416]">Not set</span>}
                </button>
              )}
              <button type="button" onClick={() => setConfirm({ title: "Leave this group?", body: "You won't see it any more. Your past expenses and payments stay in it.", action: "Leave", run: () => act.mutateAsync({ path: "/leave", done: "You left the group." }), after: () => { onOpenChange(false); navigate({ name: "home" }, { replace: true }); } })}
                className={cn(rowClass, "cursor-pointer gap-3 text-[15px]")}><LogOut className="size-[18px] text-muted-foreground" />Leave group</button>
              {isAdmin && (
                <button type="button" onClick={() => setConfirm({ title: `Delete “${group.data?.group.name}”?`, body: "This deletes the group with all its expenses and payments, for everyone. It can't be undone.", action: "Delete group", run: () => act.mutateAsync({ path: "/delete", done: "Group deleted." }), after: () => { onOpenChange(false); navigate({ name: "home" }, { replace: true }); } })}
                  className={cn(rowClass, "cursor-pointer gap-3 text-[15px] text-negative")}><Trash2 className="size-[18px]" />Delete group</button>
              )}
            </List>
          </section>
        </div>
        <AlertDialog open={pinOpen} onOpenChange={o => { if (!o && !act.isPending) setPinOpen(false); }}>
          <AlertDialogContent className="max-w-[360px] rounded-[26px] border-0 p-6">
            <form className="space-y-4" onSubmit={e => { e.preventDefault(); if (pins.a !== pins.b) { toast.error("The two PINs don't match."); return; } act.mutate({ path: "/pin", body: { pin: pins.a }, done: "Group PIN saved. Share it with the members." }, { onSuccess: () => setPinOpen(false) }); }}>
              <AlertDialogHeader>
                <AlertDialogTitle className="title-2">{group.data?.group.hasPin ? "Change group PIN" : "Set a group PIN"}</AlertDialogTitle>
                <AlertDialogDescription>Members need it to join and to open the group (remembered for a day on each phone). Everyone else enters the new PIN next time; they'll get a notification.</AlertDialogDescription>
              </AlertDialogHeader>
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1.5"><span className="eyebrow block px-1">New PIN</span><PinInput id="group-pin-new" value={pins.a} onChange={v => setPins(x => ({ ...x, a: v }))} autoComplete="off" autoFocus /></label>
                <label className="space-y-1.5"><span className="eyebrow block px-1">Confirm</span><PinInput id="group-pin-new2" value={pins.b} onChange={v => setPins(x => ({ ...x, b: v }))} autoComplete="off" /></label>
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel type="button" disabled={act.isPending} className="rounded-full border-0 bg-[#141716]/[0.06] shadow-none">Cancel</AlertDialogCancel>
                <LoadingButton type="submit" disabled={pins.a.length !== 4 || pins.b.length !== 4} loading={act.isPending} loadingText="Saving…">Save PIN</LoadingButton>
              </AlertDialogFooter>
            </form>
          </AlertDialogContent>
        </AlertDialog>
        <AlertDialog open={!!confirm} onOpenChange={o => { if (!o && !act.isPending) setConfirm(null); }}>
          <AlertDialogContent className="max-w-[360px] rounded-[26px] border-0 p-6">
            <AlertDialogHeader>
              <AlertDialogTitle className="title-2">{confirm?.title}</AlertDialogTitle>
              <AlertDialogDescription>{confirm?.body}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={act.isPending} className="rounded-full border-0 bg-[#141716]/[0.06] shadow-none">Cancel</AlertDialogCancel>
              <LoadingButton variant="destructive" loading={act.isPending} loadingText="Working…" onClick={async () => { const c = confirm; if (!c) return; try { await c.run(); setConfirm(null); c.after?.(); } catch { /* toast shown */ } }}>{confirm?.action}</LoadingButton>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DrawerContent>
    </Drawer>
  );
}

// Add friend / Requested / Accept next to people in the group.
function FriendButton({ m }: { m: Member }) {
  const add = useAccountAction((v: { action: "request" | "accept" }) => v.action === "request" ? post("/api/friends/request", { userId: m.id }) : post(`/api/friends/${m.id}/accept`), v => v.action === "request" ? `Friend request sent to ${m.name}.` : `You and ${m.name} are friends now.`);
  if (m.friend === "friend") return null;
  if (m.friend === "requested") return <span title="Friend request sent" className="shrink-0 rounded-full bg-[#141716]/[0.04] px-2 py-1 text-[11.5px] text-muted-foreground">Requested</span>;
  // Compact, so names keep their room: a round icon (with a label for screen
  // readers), or "Accept" when they asked me.
  return m.friend === "asked_you" ? (
    <LoadingButton type="button" size="sm" variant="secondary" aria-label={"Accept friend request from " + m.name} className="h-7 shrink-0 rounded-full px-2.5 text-[12px]" loading={add.isPending} loadingText="…" onClick={() => add.mutate({ action: "accept" })}>
      <UserPlus className="size-3.5" />Accept
    </LoadingButton>
  ) : (
    <button type="button" aria-label={"Add friend " + m.name} title="Add friend" disabled={add.isPending} onClick={() => add.mutate({ action: "request" })}
      className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-full border border-[#141716]/[0.1] bg-white transition-transform active:scale-90 disabled:opacity-50">
      <UserPlus className="size-4" />
    </button>
  );
}

function MemberRow({ m, isMe, isAdmin, lastAdmin, busy, onAction, onRemove }: {
  m: Member; isMe: boolean; isAdmin: boolean; lastAdmin: boolean; busy: boolean; onAction: (path: string, done: string) => void; onRemove: () => void;
}) {
  return (
    <div className={rowClass}>
      <PersonAvatar id={m.id} name={m.name} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium">{m.name}{isMe && <span className="font-normal text-muted-foreground"> (you)</span>}</span>
        <span className="block truncate text-[12.5px] text-muted-foreground">{m.username ? "@" + m.username : "Member"}</span>
      </span>
      {!isMe && <FriendButton m={m} />}
      {m.role === "admin" && <span className="inline-flex items-center gap-1 rounded-full bg-tint-soft px-2 py-0.5 text-[12px] font-medium text-tint"><ShieldCheck className="size-3.5" />Admin</span>}
      {isAdmin && !(isMe && lastAdmin) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label={"Manage " + m.name} disabled={busy} className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-full bg-[#141716]/[0.05] transition-transform active:scale-90"><MoreHorizontal className="size-4" /></button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52 rounded-[16px]">
            {m.role === "admin"
              ? !lastAdmin && <DropdownMenuItem onSelect={() => onAction(`/members/${m.id}/make-member`, isMe ? "You're a regular member now." : `${m.name} is a regular member now.`)}><UserMinus />{isMe ? "Stop being admin" : "Remove as admin"}</DropdownMenuItem>
              : <DropdownMenuItem onSelect={() => onAction(`/members/${m.id}/make-admin`, `${m.name} is now an admin.`)}><ShieldCheck />Make admin</DropdownMenuItem>}
            {!isMe && !lastAdmin && <DropdownMenuItem variant="destructive" onSelect={onRemove}><Trash2 />Remove from group</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

// Admins invite anyone by username or email, or pick a friend. Members can
// only suggest a friend; an admin approves before the friend is invited.
function InviteForm({ groupId, isAdmin, taken }: { groupId: string; isAdmin: boolean; taken: Set<string> }) {
  const [login, setLogin] = React.useState("");
  const friends = useFriends();
  const invite = useAccountAction((v: string) => post<{ status: "invited" | "active" | "suggested"; name: string }>(`/api/groups/${groupId}/members/invite`, { login: v }));
  const send = (v: string) => invite.mutate(v, { onSuccess: d => { setLogin(""); toast.success(d.status === "active" ? `${d.name} is in.` : d.status === "suggested" ? `Suggested ${d.name}. An admin will approve.` : `Invited ${d.name}. They join when they accept.`); } });
  const pickable = (friends.data?.friends || []).filter(f => !taken.has(f.id));
  return (
    <form data-testid="invite-form" className="panel space-y-3 p-4" onSubmit={e => { e.preventDefault(); const v = login.trim(); if (v) send(v); }}>
      <p className="flex items-center gap-2 text-[15px] font-medium"><UserPlus className="size-[18px]" />{isAdmin ? "Invite someone" : "Suggest a friend"}</p>
      {pickable.length > 0 && (
        <div className="flex flex-wrap gap-2" data-testid="friend-picks">
          {pickable.map(f => (
            <button key={f.id} type="button" disabled={invite.isPending} onClick={() => send(f.username)} aria-label={(isAdmin ? "Invite " : "Suggest ") + f.name}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-[#141716]/[0.05] py-1 pr-3 pl-1 text-[13.5px] font-medium transition-transform active:scale-95 disabled:opacity-50">
              <PersonAvatar id={f.id} name={f.name} size="sm" className="size-6 text-[10px]" />{f.name}
            </button>
          ))}
        </div>
      )}
      {isAdmin ? (
        <>
          <div className="flex gap-2">
            <Input aria-label="Username or email to invite" autoCapitalize="none" spellCheck={false} placeholder="Username or email" value={login} onChange={e => setLogin(e.target.value)} className={cn(fieldClass, "h-11 min-w-0 flex-1")} />
            <LoadingButton type="submit" className="h-11 shrink-0 rounded-full px-5" disabled={!login.trim()} loading={invite.isPending} loadingText="Inviting…">Invite</LoadingButton>
          </div>
          <p className="text-[12.5px] text-muted-foreground">They need a Split It account. They'll see the invitation when they open the app.</p>
        </>
      ) : (
        <p className="text-[12.5px] text-muted-foreground">{pickable.length ? "Tap a friend to suggest them. An admin approves, then they're invited." : "Add friends (account menu → Friends) to suggest them here. Or share the invite link below."}</p>
      )}
    </form>
  );
}
