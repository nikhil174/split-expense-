import * as React from "react";
import { toast } from "sonner";
import { Check, UserPlus, Users, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { EmptyState, List, LoadingButton, Page, PersonAvatar, SectionTitle, fieldClass, rowClass } from "@/components/app/bits";
import { BackButton } from "@/features/groups/GroupScreen";
import { useAccountAction, useFriends } from "@/hooks/queries";
import { post, type Friend } from "@/lib/api";
import { goBack } from "@/lib/route";
import { cn } from "@/lib/utils";

// Your friends: add by username or email, answer requests, remove. Friends
// can be invited to (or, by members, suggested for) your groups.
export function FriendsScreen() {
  const q = useFriends();
  const [login, setLogin] = React.useState("");
  const request = useAccountAction((v: string) => post<{ status: string; name: string }>("/api/friends/request", { login: v }));
  const act = useAccountAction((v: { id: string; action: "accept" | "decline" | "remove"; done: string }) => post(`/api/friends/${v.id}/${v.action}`), v => v.done);
  const d = q.data;
  return (
    <Page>
      <BackButton label="Home" onClick={() => goBack({ name: "home" })} />
      <h1 className="page-title mt-3 px-1">Friends</h1>
      <form className="panel mt-5 space-y-3 p-4" data-testid="add-friend" onSubmit={e => { e.preventDefault(); const v = login.trim(); if (v) request.mutate(v, { onSuccess: r => { setLogin(""); toast.success(r.status === "friends" ? `You and ${r.name} are friends now.` : `Request sent to ${r.name}.`); } }); }}>
        <p className="flex items-center gap-2 text-[15px] font-medium"><UserPlus className="size-[18px]" />Add a friend</p>
        <div className="flex gap-2">
          <Input aria-label="Friend's username or email" autoCapitalize="none" spellCheck={false} placeholder="Username or email" value={login} onChange={e => setLogin(e.target.value)} className={cn(fieldClass, "h-11 min-w-0 flex-1")} />
          <LoadingButton type="submit" className="h-11 shrink-0 rounded-full px-5" disabled={!login.trim()} loading={request.isPending} loadingText="Sending…">Add</LoadingButton>
        </div>
        <p className="text-[12.5px] text-muted-foreground">They'll get a request to accept. Friends can invite each other to groups.</p>
      </form>

      {d && d.incoming.length > 0 && (
        <section className="mt-7" data-testid="friend-requests">
          <SectionTitle>Requests</SectionTitle>
          <List inset={60}>
            {d.incoming.map(f => (
              <Row key={f.id} f={f}>
                <button type="button" aria-label={"Decline " + f.name} disabled={act.isPending} onClick={() => act.mutate({ id: f.id, action: "decline", done: "Request declined." })} className="grid size-9 cursor-pointer place-items-center rounded-full bg-[#141716]/[0.06] transition-transform active:scale-90"><X className="size-4" strokeWidth={2.4} /></button>
                <button type="button" aria-label={"Accept " + f.name} disabled={act.isPending} onClick={() => act.mutate({ id: f.id, action: "accept", done: `You and ${f.name} are friends now.` })} className="grid size-9 cursor-pointer place-items-center rounded-full bg-[#141716] text-white transition-transform active:scale-90"><Check className="size-4" strokeWidth={2.6} /></button>
              </Row>
            ))}
          </List>
        </section>
      )}

      <section className="mt-7">
        <SectionTitle>{d ? `${d.friends.length} ${d.friends.length === 1 ? "friend" : "friends"}` : "Friends"}</SectionTitle>
        <List inset={60}>
          {q.isPending ? <div className="p-4"><div className="h-10 animate-pulse rounded-[12px] bg-[#141716]/[0.05]" /></div> : !d?.friends.length ? (
            <EmptyState icon={<Users />} title="No friends yet">Add people by their username or email, or tap Add friend next to someone in a group.</EmptyState>
          ) : d.friends.map(f => (
            <Row key={f.id} f={f}>
              <button type="button" disabled={act.isPending} onClick={() => { if (window.confirm(`Remove ${f.name} from your friends?`)) act.mutate({ id: f.id, action: "remove", done: `${f.name} removed.` }); }} className="cursor-pointer rounded-full bg-[#141716]/[0.05] px-3 py-1.5 text-[13px] font-medium transition-transform active:scale-95">Remove</button>
            </Row>
          ))}
        </List>
      </section>

      {d && d.outgoing.length > 0 && (
        <section className="mt-7">
          <SectionTitle>Waiting for them</SectionTitle>
          <List inset={60}>
            {d.outgoing.map(f => (
              <Row key={f.id} f={f}>
                <button type="button" disabled={act.isPending} onClick={() => act.mutate({ id: f.id, action: "remove", done: "Request cancelled." })} className="cursor-pointer rounded-full bg-[#141716]/[0.05] px-3 py-1.5 text-[13px] font-medium transition-transform active:scale-95">Cancel</button>
              </Row>
            ))}
          </List>
        </section>
      )}
    </Page>
  );
}

function Row({ f, children }: { f: Friend; children: React.ReactNode }) {
  return (
    <div className={rowClass}>
      <PersonAvatar id={f.id} name={f.name} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium">{f.name}</span>
        <span className="block truncate text-[12.5px] text-muted-foreground">@{f.username}</span>
      </span>
      <span className="flex shrink-0 gap-1.5">{children}</span>
    </div>
  );
}
