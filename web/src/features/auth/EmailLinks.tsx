import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, KeyRound, Link2Off } from "lucide-react";
import { toast } from "sonner";
import { LoadingButton, Wordmark } from "@/components/app/bits";
import { PasswordInput, PasswordStrength, goodPassword } from "@/components/app/secrets";
import { keys } from "@/hooks/queries";
import { get, post } from "@/lib/api";
import { navigate } from "@/lib/route";
import { Field } from "./AuthScreen";

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <div className="mx-auto flex max-w-md flex-col items-center px-4 pt-[max(3rem,env(safe-area-inset-top))] pb-10">
        <Wordmark large />
        <div className="panel mt-8 w-full space-y-5 p-6 text-center">{children}</div>
      </div>
    </div>
  );
}
const home = () => navigate({ name: "home" }, { replace: true });

// The page a "reset your password" email opens (signed in or out). A new
// password signs out every device and signs in here.
export function ResetPasswordScreen({ token }: { token: string }) {
  const qc = useQueryClient();
  const check = useQuery({ queryKey: ["reset", token], queryFn: () => get<{ username: string; name: string }>("/api/auth/reset/" + encodeURIComponent(token)), retry: false, staleTime: 0, gcTime: 0 });
  const [f, setF] = React.useState({ a: "", b: "" });
  const [busy, setBusy] = React.useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (f.a !== f.b) { toast.error("The two passwords don't match."); return; }
    setBusy(true);
    try {
      await post("/api/auth/reset", { token, password: f.a });
      qc.removeQueries({ queryKey: ["reset", token] });
      await qc.invalidateQueries({ queryKey: keys.me });
      toast.success("Password changed. You're signed in.");
      home();
    } catch (err) { toast.error((err as Error).message); }
    finally { setBusy(false); }
  };
  if (check.isPending) return <Frame><div className="h-40 animate-pulse rounded-[14px] bg-[#141716]/[0.04]" /></Frame>;
  if (check.error) return (
    <Frame>
      <span className="mx-auto grid size-14 place-items-center rounded-full bg-[#141716]/[0.05]"><Link2Off className="size-6" /></span>
      <p className="title-2">Link expired</p>
      <p className="text-[14px] text-muted-foreground">{(check.error as Error).message}</p>
      <LoadingButton size="lg" className="w-full rounded-full" onClick={home}>Back to sign in</LoadingButton>
    </Frame>
  );
  return (
    <Frame>
      <span className="mx-auto grid size-14 place-items-center rounded-full bg-[#141716] text-white"><KeyRound className="size-6" /></span>
      <div>
        <p className="title-2">Choose a new password</p>
        <p className="mt-1 text-[14px] text-muted-foreground">For {check.data?.name} (@{check.data?.username}). You'll be signed out on every other device.</p>
      </div>
      <form className="space-y-4 text-left" onSubmit={save}>
        <Field label="New password" htmlFor="reset-a"><PasswordInput id="reset-a" value={f.a} onChange={v => setF(x => ({ ...x, a: v }))} autoComplete="new-password" placeholder="New password" autoFocus /></Field>
        <div>
          <Field label="Confirm password" htmlFor="reset-b"><PasswordInput id="reset-b" value={f.b} onChange={v => setF(x => ({ ...x, b: v }))} autoComplete="new-password" placeholder="Type it again" /></Field>
          <p className="footnote mt-2 px-1 text-muted-foreground"><PasswordStrength value={f.a} /></p>
        </div>
        <LoadingButton type="submit" size="lg" className="w-full rounded-full" disabled={!goodPassword(f.a) || !f.b} loading={busy} loadingText="Saving…">Save new password</LoadingButton>
      </form>
    </Frame>
  );
}

// The page a "confirm your email" email opens.
export function VerifyEmailScreen({ token, signedIn }: { token: string; signedIn: boolean }) {
  const qc = useQueryClient();
  const [state, setState] = React.useState<{ ok?: string; error?: string }>({});
  const ran = React.useRef(false);
  React.useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    post<{ email: string }>("/api/auth/verify-email", { token })
      .then(d => { setState({ ok: d.email }); qc.invalidateQueries({ queryKey: keys.me }); })
      .catch(e => setState({ error: (e as Error).message }));
  }, [token, qc]);
  return (
    <Frame>
      {!state.ok && !state.error ? <p className="py-6 text-[15px] text-muted-foreground">Confirming your email…</p> : state.ok ? (
        <>
          <span className="mx-auto grid size-14 place-items-center rounded-full bg-positive-soft text-positive"><BadgeCheck className="size-7" /></span>
          <p className="title-2">Email confirmed</p>
          <p className="text-[14px] text-muted-foreground">{state.ok} is confirmed. If you ever forget your password, we can send a reset link there.</p>
        </>
      ) : (
        <>
          <span className="mx-auto grid size-14 place-items-center rounded-full bg-[#141716]/[0.05]"><Link2Off className="size-6" /></span>
          <p className="title-2">Link expired</p>
          <p className="text-[14px] text-muted-foreground">{state.error}</p>
        </>
      )}
      <LoadingButton size="lg" className="w-full rounded-full" onClick={home}>{signedIn ? "Open Split It" : "Sign in"}</LoadingButton>
    </Frame>
  );
}
