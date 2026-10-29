import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, m } from "motion/react";
import { toast } from "sonner";
import { CheckCircle2, Clock3, ShieldCheck, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { EASE, LoadingButton, Segmented } from "@/components/app/bits";
import { get, post } from "@/lib/api";
import { keys } from "@/hooks/queries";

type PublicGroup = { id: string; name: string };
const REQUEST_KEY = "splitRequest";
const storage = {
  get: () => { try { return localStorage.getItem(REQUEST_KEY) || ""; } catch { return ""; } },
  set: (v: string) => { try { if (v) localStorage.setItem(REQUEST_KEY, v); else localStorage.removeItem(REQUEST_KEY); } catch { /* private mode */ } },
};

function GroupSelect({ id, value, onChange, groups }: { id: string; value: string; onChange: (v: string) => void; groups: PublicGroup[] | undefined }) {
  return (
    <select id={id} required value={value} onChange={e => onChange(e.target.value)} disabled={!groups?.length}
      className="h-11 w-full rounded-xl border border-input bg-card px-3 text-[15px] shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50">
      <option value="">{groups === undefined ? "Loading groups…" : groups.length ? "Choose a group" : "No groups yet — ask the admin"}</option>
      {groups?.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
    </select>
  );
}

function Field({ label, htmlFor, children, hint }: { label: string; htmlFor: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-[13px]">{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function AuthScreen() {
  const qc = useQueryClient();
  const [tab, setTab] = React.useState<"signin" | "request">("signin");
  const [mode, setMode] = React.useState<"member" | "admin">("member");
  const [busy, setBusy] = React.useState(false);
  const [requestId, setRequestId] = React.useState(storage.get);
  const groups = useQuery({ queryKey: ["public-groups"], queryFn: () => get<{ groups: PublicGroup[] }>("/api/groups/public").then(d => d.groups) });
  const [form, setForm] = React.useState({ groupId: "", name: "", adminName: "", pin: "", requestName: "", requestGroup: "" });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement> | string) => setForm(f => ({ ...f, [k]: typeof e === "string" ? e : e.target.value }));

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  const signedIn = async (message: string) => {
    await qc.invalidateQueries({ queryKey: keys.me });
    toast.success(message);
  };

  return (
    <div className="min-h-dvh bg-[radial-gradient(120%_60%_at_0%_0%,color-mix(in_oklch,var(--primary)_18%,transparent),transparent_60%)]">
      <div className="mx-auto flex max-w-md flex-col px-5 pt-[max(2.5rem,env(safe-area-inset-top))] pb-12">
        <m.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE }}>
          <div className="mb-8 flex items-center gap-2.5">
            <div className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/30">
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round"><path d="M6 16 18 8M11 8h7v7" /></svg>
            </div>
            <span className="text-lg font-bold tracking-tight">Split Expense</span>
          </div>
          <h1 className="text-[34px] leading-[1.05] font-bold tracking-tight">Good times.<br /><span className="text-primary">Clear balances.</span></h1>
          <p className="mt-3 text-[15px] text-muted-foreground">Track shared spending, see exactly who owes whom, and settle up in a tap.</p>
        </m.div>

        <Segmented id="auth-tab" className="mt-8" value={tab} onChange={setTab}
          options={[{ value: "signin", label: "Sign in" }, { value: "request", label: "Request access" }]} />

        <Card className="mt-4 rounded-2xl border-0 py-0 shadow-xl shadow-primary/5">
          <CardContent className="p-5">
            <AnimatePresence mode="wait" initial={false}>
              {tab === "signin" ? (
                <m.div key="signin" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} transition={{ duration: 0.2, ease: EASE }} className="space-y-4">
                  <Segmented id="auth-mode" value={mode} onChange={setMode} options={[
                    { value: "member", label: <span className="inline-flex items-center gap-1.5"><Users className="size-3.5" />Member</span> },
                    { value: "admin", label: <span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-3.5" />Admin</span> },
                  ]} />
                  {mode === "member" ? (
                    <form className="space-y-4" onSubmit={e => { e.preventDefault(); run(async () => {
                      await post("/api/access/signin", { name: form.name.trim(), groupId: form.groupId });
                      setForm(f => ({ ...f, name: "" }));
                      await signedIn("Signed in. Welcome back!");
                    }); }}>
                      <Field label="Group" htmlFor="signin-group"><GroupSelect id="signin-group" value={form.groupId} onChange={set("groupId")} groups={groups.data} /></Field>
                      <Field label="Your approved name" htmlFor="signin-name" hint="No password needed — your name must be approved for this group.">
                        <Input id="signin-name" required minLength={2} maxLength={60} autoComplete="name" placeholder="Name used in your request" value={form.name} onChange={set("name")} className="h-11 rounded-xl text-[15px]" />
                      </Field>
                      <LoadingButton type="submit" size="xl" className="w-full" loading={busy} loadingText="Signing in…">Sign in</LoadingButton>
                    </form>
                  ) : (
                    <form className="space-y-4" onSubmit={e => { e.preventDefault(); run(async () => {
                      await post("/api/admin/login", { name: form.adminName.trim(), pin: form.pin });
                      setForm(f => ({ ...f, pin: "" }));
                      await signedIn("Signed in as admin.");
                    }); }}>
                      <Field label="Admin name" htmlFor="admin-name">
                        <Input id="admin-name" required minLength={2} maxLength={60} autoComplete="name" placeholder="Your saved administrator name" value={form.adminName} onChange={set("adminName")} className="h-11 rounded-xl text-[15px]" />
                      </Field>
                      <Field label="PIN" htmlFor="admin-pin" hint="As admin you get both views: your own groups and the admin dashboard.">
                        <Input id="admin-pin" type="password" required autoComplete="current-password" placeholder="Admin PIN" value={form.pin} onChange={set("pin")} className="h-11 rounded-xl text-[15px]" />
                      </Field>
                      <LoadingButton type="submit" size="xl" className="w-full" loading={busy} loadingText="Signing in…">Sign in as admin</LoadingButton>
                    </form>
                  )}
                </m.div>
              ) : (
                <m.div key="request" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.2, ease: EASE }}>
                  {requestId ? (
                    <RequestStatus requestId={requestId} busy={busy} run={run} onReset={() => { storage.set(""); setRequestId(""); }} onEntered={() => signedIn("You're in!")} />
                  ) : (
                    <form className="space-y-4" onSubmit={e => { e.preventDefault(); run(async () => {
                      const d = await post<{ requestId: string; message: string }>("/api/access/request", { name: form.requestName.trim(), groupId: form.requestGroup });
                      storage.set(d.requestId);
                      setRequestId(d.requestId);
                      setForm(f => ({ ...f, requestName: "" }));
                      toast.success(d.message);
                    }); }}>
                      <Field label="Group" htmlFor="request-group"><GroupSelect id="request-group" value={form.requestGroup} onChange={set("requestGroup")} groups={groups.data} /></Field>
                      <Field label="Your name" htmlFor="request-name" hint="The admin approves your request, then you can sign in with this name.">
                        <Input id="request-name" required minLength={2} maxLength={60} autoComplete="name" placeholder="Full name" value={form.requestName} onChange={set("requestName")} className="h-11 rounded-xl text-[15px]" />
                      </Field>
                      <LoadingButton type="submit" size="xl" className="w-full" loading={busy} loadingText="Sending request…">Request access</LoadingButton>
                    </form>
                  )}
                </m.div>
              )}
            </AnimatePresence>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function RequestStatus({ requestId, busy, run, onReset, onEntered }: {
  requestId: string; busy: boolean; run: (fn: () => Promise<void>) => Promise<void>; onReset: () => void; onEntered: () => Promise<void>;
}) {
  const status = useQuery({
    queryKey: ["request-status", requestId],
    queryFn: () => get<{ status: string; name?: string }>("/api/access/status?requestId=" + encodeURIComponent(requestId)),
    refetchInterval: q => (q.state.data?.status === "pending" ? 15_000 : false),
  });
  const s = status.data?.status;
  return (
    <div className="space-y-4 text-center">
      <div className={`mx-auto grid size-14 place-items-center rounded-2xl ${s === "approved" ? "bg-positive-soft text-positive" : "bg-accent text-accent-foreground"}`}>
        {s === "approved" ? <CheckCircle2 className="size-7" /> : <Clock3 className="size-7" />}
      </div>
      <div>
        <p className="text-lg font-semibold">{s === "approved" ? "You're approved!" : s === "pending" ? "Waiting for approval" : s ? "Access " + s : "Checking…"}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {s === "approved" ? "Continue to start your session." : s === "pending" ? "We check for you automatically. You can also ask the admin to approve you." : s ? "Request access again if you still need it." : ""}
        </p>
      </div>
      {s === "approved" ? (
        <LoadingButton size="xl" className="w-full" loading={busy} loadingText="Opening…" onClick={() => run(async () => { await post("/api/access/enter", { requestId }); await onEntered(); })}>Continue</LoadingButton>
      ) : (
        <LoadingButton size="xl" variant="secondary" className="w-full" loading={status.isFetching} loadingText="Checking…" onClick={() => status.refetch()}>Check approval</LoadingButton>
      )}
      <Button variant="link" onClick={onReset}>Request with a different name or group</Button>
    </div>
  );
}
