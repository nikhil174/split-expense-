import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Clock3, Link2, QrCode as QrIcon, Users } from "lucide-react";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { EmptyState, LoadingButton, Page, PersonAvatar, Segmented, fieldClass } from "@/components/app/bits";
import { PinInput } from "@/components/app/secrets";
import { SheetHeader } from "@/features/groups/AddExpenseDrawer";
import { BackButton } from "@/features/groups/GroupScreen";
import { useAccountAction } from "@/hooks/queries";
import { get, post, type JoinInfo } from "@/lib/api";
import { goBack, joinCodeFrom, navigate } from "@/lib/route";
import { QrScanner } from "./Qr";

// What an invite link / QR opens: which group it is, then "Ask to join"
// with the group's PIN. A group admin lets you in.
export function JoinScreen({ code }: { code: string }) {
  const q = useQuery({ queryKey: ["join", code], queryFn: () => get<JoinInfo>("/api/join/" + encodeURIComponent(code)), retry: false });
  const [pin, setPin] = React.useState("");
  const ask = useAccountAction(() => post<{ status: string; groupId: string }>("/api/join/" + encodeURIComponent(code), { pin }));
  const g = q.data;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    ask.mutate(undefined, {
      onSuccess: d => { if (d.status === "active") navigate({ name: "group", groupId: d.groupId, tab: "expenses" }, { replace: true }); else q.refetch(); },
      onError: () => setPin(""),
    });
  };
  return (
    <Page>
      <BackButton label="Home" onClick={() => goBack({ name: "home" })} />
      {q.isPending ? <div className="panel mt-6 h-64 animate-pulse" /> : q.error || !g ? (
        <div className="mt-6"><EmptyState icon={<Link2 />} title="This invite doesn't work">{(q.error as Error)?.message || "Ask someone in the group for a new link."}</EmptyState></div>
      ) : (
        <div className="panel mx-auto mt-6 max-w-sm space-y-5 p-6 text-center" data-testid="join-card">
          <PersonAvatar id={g.groupId} name={g.groupName} size="lg" className="mx-auto" />
          <div>
            <p className="eyebrow">You're invited to join</p>
            <h1 className="title-2 mt-1 break-words">{g.groupName}</h1>
            <p className="mt-1 inline-flex items-center gap-1 text-[14px] text-muted-foreground"><Users className="size-4" />{g.memberCount} {g.memberCount === 1 ? "member" : "members"}</p>
          </div>
          {g.status === "active" ? (
            <LoadingButton size="lg" className="w-full rounded-full" onClick={() => navigate({ name: "group", groupId: g.groupId, tab: "expenses" }, { replace: true })}><Check className="size-4" />You're in. Open the group</LoadingButton>
          ) : g.status === "pending" ? (
            <p className="flex items-center justify-center gap-2 rounded-[14px] bg-tint-soft px-4 py-3 text-[14px] text-tint"><Clock3 className="size-4" />You've asked to join. A group admin will let you in; you'll get a notification.</p>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              {g.hasPin && (
                <div className="space-y-1.5 text-left">
                  <label htmlFor="join-link-pin" className="eyebrow block px-1">Group PIN</label>
                  <PinInput id="join-link-pin" value={pin} onChange={setPin} autoComplete="off" autoFocus />
                  <p className="px-1 text-[12.5px] text-muted-foreground">Whoever shared the link can tell you.</p>
                </div>
              )}
              <LoadingButton type="submit" size="lg" className="w-full rounded-full" disabled={g.hasPin && pin.length !== 4} loading={ask.isPending} loadingText="Sending…">
                {g.status === "invited" ? "Join group" : "Ask to join"}
              </LoadingButton>
              {g.status !== "invited" && <p className="text-[12.5px] text-muted-foreground">A group admin approves new members.</p>}
            </form>
          )}
        </div>
      )}
    </Page>
  );
}

// Home → "Join": scan a group's QR with the camera, or paste its link.
export function JoinSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [mode, setMode] = React.useState<"scan" | "link">("scan");
  const [text, setText] = React.useState("");
  React.useEffect(() => { if (open) setText(""); }, [open]);
  const go = (code: string) => { onOpenChange(false); navigate({ name: "join", code }); };
  const code = joinCodeFrom(text);
  return (
    <Drawer open={open} onOpenChange={onOpenChange} repositionInputs={false}>
      <DrawerContent className="mx-auto max-h-[92dvh] max-w-xl rounded-t-[28px] border-0">
        <SheetHeader title="Join a group" description="Scan the group's QR, or paste its invite link." />
        <div className="safe-bottom min-h-0 space-y-4 overflow-y-auto px-5 pt-1 pb-6">
          <Segmented id="join-mode" value={mode} onChange={setMode} options={[{ value: "scan", label: <span className="inline-flex items-center gap-1.5"><QrIcon className="size-4" />Scan QR</span> }, { value: "link", label: <span className="inline-flex items-center gap-1.5"><Link2 className="size-4" />Paste link</span> }]} />
          {open && mode === "scan" ? <QrScanner onCode={go} /> : (
            <form className="space-y-3" onSubmit={e => { e.preventDefault(); if (code) go(code); }}>
              <Input aria-label="Invite link" autoFocus autoCapitalize="none" spellCheck={false} placeholder="https://…/#/join/…" value={text} onChange={e => setText(e.target.value)} className={fieldClass} />
              <LoadingButton type="submit" size="lg" className="w-full rounded-full" disabled={!code}>Open invite</LoadingButton>
              {text && !code && <p className="text-center text-[13px] text-negative">That doesn't look like a Split It invite link.</p>}
            </form>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
