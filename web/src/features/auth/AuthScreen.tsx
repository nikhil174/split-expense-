import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, m } from "motion/react";
import { toast } from "sonner";
import { Check, Clock3 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { EASE, LoadingButton, NativeSelect, Segmented, Wordmark, fieldClass, haptic } from "@/components/app/bits";
import { get, post } from "@/lib/api";
import { keys } from "@/hooks/queries";
import { cn } from "@/lib/utils";

type PublicGroup = { id: string; name: string };
const REQUEST_KEY = "splitRequest";
const storage = {
  get: () => { try { return localStorage.getItem(REQUEST_KEY) || ""; } catch { return ""; } },
  set: (v: string) => { try { if (v) localStorage.setItem(REQUEST_KEY, v); else localStorage.removeItem(REQUEST_KEY); } catch { /* private mode */ } },
};

function GroupSelect({ id, value, onChange, groups }: { id: string; value: string; onChange: (v: string) => void; groups: PublicGroup[] | undefined }) {
  return (
    <NativeSelect id={id} required value={value} onChange={e => onChange(e.target.value)} disabled={!groups?.length}>
      <option value="">{groups === undefined ? "Loading groups…" : groups.length ? "Choose a group" : "No groups yet — ask the admin"}</option>
      {groups?.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
    </NativeSelect>
  );
}

function Field({ label, htmlFor, children, hint }: { label: string; htmlFor: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor} className="text-[12.5px] font-medium text-muted-foreground">{label}</Label>
      {children}
      {hint && <p className="text-[12.5px] leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
}

const fade = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -6 }, transition: { duration: 0.25, ease: EASE } };

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
    haptic();
    await qc.invalidateQueries({ queryKey: keys.me });
    toast.success(message);
  };

  return (
    <div className="min-h-dvh">
      <div className="mx-auto flex min-h-dvh max-w-md flex-col px-6 pt-[max(1.75rem,env(safe-area-inset-top))] pb-10">
        <m.header {...fade} className="flex items-center justify-between">
          <Wordmark />
          <span className="eyebrow">Shared expenses</span>
        </m.header>

        <m.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE, delay: 0.05 }} className="mt-14">
          <h1 className="font-serif text-[46px] leading-[0.98] tracking-[-0.025em]">
            Shared spending,<br /><span className="text-brass italic">settled gracefully.</span>
          </h1>
          <p className="mt-4 max-w-[30ch] text-[15px] leading-relaxed text-muted-foreground">Every rupee accounted for. See exactly who owes whom, and settle up in a tap.</p>
        </m.div>

        <m.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE, delay: 0.12 }} className="mt-10">
          <Segmented id="auth-tab" value={tab} onChange={setTab} options={[{ value: "signin", label: "Sign in" }, { value: "request", label: "Request access" }]} />

          <div className="panel mt-4 p-5">
            <AnimatePresence mode="wait" initial={false}>
              {tab === "signin" ? (
                <m.div key="signin" {...fade} className="space-y-5">
                  <Segmented id="auth-mode" value={mode} onChange={setMode} options={[{ value: "member", label: "Member" }, { value: "admin", label: "Admin" }]} />
                  {mode === "member" ? (
                    <form className="space-y-5" onSubmit={e => { e.preventDefault(); run(async () => {
                      await post("/api/access/signin", { name: form.name.trim(), groupId: form.groupId });
                      setForm(f => ({ ...f, name: "" }));
                      await signedIn("Welcome back.");
                    }); }}>
                      <Field label="Group" htmlFor="signin-group"><GroupSelect id="signin-group" value={form.groupId} onChange={set("groupId")} groups={groups.data} /></Field>
                      <Field label="Your approved name" htmlFor="signin-name" hint="No password — your name must be approved for this group.">
                        <Input id="signin-name" required minLength={2} maxLength={60} autoComplete="name" placeholder="Name used in your request" value={form.name} onChange={set("name")} className={fieldClass} />
                      </Field>
                      <LoadingButton type="submit" size="xl" className="w-full" loading={busy} loadingText="Signing in…">Sign in</LoadingButton>
                    </form>
                  ) : (
                    <form className="space-y-5" onSubmit={e => { e.preventDefault(); run(async () => {
                      await post("/api/admin/login", { name: form.adminName.trim(), pin: form.pin });
                      setForm(f => ({ ...f, pin: "" }));
                      await signedIn("Signed in as admin.");
                    }); }}>
                      <Field label="Admin name" htmlFor="admin-name">
                        <Input id="admin-name" required minLength={2} maxLength={60} autoComplete="name" placeholder="Your saved administrator name" value={form.adminName} onChange={set("adminName")} className={fieldClass} />
                      </Field>
                      <Field label="PIN" htmlFor="admin-pin" hint="As admin you get both views: your own groups and the admin dashboard.">
                        <Input id="admin-pin" type="password" required autoComplete="current-password" placeholder="••••" value={form.pin} onChange={set("pin")} className={cn(fieldClass, "tracking-widest")} />
                      </Field>
                      <LoadingButton type="submit" size="xl" className="w-full" loading={busy} loadingText="Signing in…">Sign in as admin</LoadingButton>
                    </form>
                  )}
                </m.div>
              ) : (
                <m.div key="request" {...fade}>
                  {requestId ? (
                    <RequestStatus requestId={requestId} busy={busy} run={run} onReset={() => { storage.set(""); setRequestId(""); }} onEntered={() => signedIn("You're in.")} />
                  ) : (
                    <form className="space-y-5" onSubmit={e => { e.preventDefault(); run(async () => {
                      const d = await post<{ requestId: string; message: string }>("/api/access/request", { name: form.requestName.trim(), groupId: form.requestGroup });
                      storage.set(d.requestId);
                      setRequestId(d.requestId);
                      setForm(f => ({ ...f, requestName: "" }));
                      haptic();
                      toast.success(d.message);
                    }); }}>
                      <Field label="Group" htmlFor="request-group"><GroupSelect id="request-group" value={form.requestGroup} onChange={set("requestGroup")} groups={groups.data} /></Field>
                      <Field label="Your name" htmlFor="request-name" hint="Once the admin approves you, sign in with this name.">
                        <Input id="request-name" required minLength={2} maxLength={60} autoComplete="name" placeholder="Full name" value={form.requestName} onChange={set("requestName")} className={fieldClass} />
                      </Field>
                      <LoadingButton type="submit" size="xl" className="w-full" loading={busy} loadingText="Sending request…">Request access</LoadingButton>
                    </form>
                  )}
                </m.div>
              )}
            </AnimatePresence>
          </div>
        </m.div>
        <p className="mt-auto pt-10 text-center text-[11.5px] text-muted-foreground/80">Amounts are kept to the exact paisa.</p>
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
    <div className="space-y-5 py-2 text-center">
      <div className={cn("mx-auto grid size-12 place-items-center rounded-full ring-1", s === "approved" ? "text-positive ring-positive/40" : "text-brass ring-brass/40")}>
        {s === "approved" ? <Check className="size-5" /> : <Clock3 className="size-5" />}
      </div>
      <div>
        <p className="font-serif text-[26px] leading-tight">{s === "approved" ? "You're approved" : s === "pending" ? "Waiting for approval" : s ? "Access " + s : "Checking…"}</p>
        <p className="mx-auto mt-1.5 max-w-[30ch] text-[13.5px] leading-relaxed text-muted-foreground">
          {s === "approved" ? "Continue to start your session." : s === "pending" ? "We check for you automatically. You can also ask the admin to approve you." : s ? "Request access again if you still need it." : ""}
        </p>
      </div>
      {s === "approved" ? (
        <LoadingButton size="xl" className="w-full" loading={busy} loadingText="Opening…" onClick={() => run(async () => { await post("/api/access/enter", { requestId }); await onEntered(); })}>Continue</LoadingButton>
      ) : (
        <LoadingButton size="xl" variant="secondary" className="w-full" loading={status.isFetching} loadingText="Checking…" onClick={() => status.refetch()}>Check approval</LoadingButton>
      )}
      <Button variant="link" className="text-muted-foreground" onClick={onReset}>Request with a different name or group</Button>
    </div>
  );
}
