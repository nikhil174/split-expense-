import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, m } from "motion/react";
import { toast } from "sonner";
import { Check, Download, X } from "lucide-react";
import { useInstallApp } from "@/components/app/InstallApp";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EASE, LoadingButton, Segmented, Wordmark, fieldClass, haptic } from "@/components/app/bits";
import { ApiError, get, post } from "@/lib/api";
import { GoogleButton, PASSWORD_HINT, PasswordInput, PasswordStrength, PinInput, goodPassword, useGoogleClientId } from "@/components/app/secrets";
import { keys } from "@/hooks/queries";

export function Field({ label, htmlFor, children, hint }: { label: string; htmlFor: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <Label htmlFor={htmlFor} className="eyebrow mb-2 block px-1">{label}</Label>
      {children}
      {hint && <p className="footnote mt-2 px-1 text-muted-foreground">{hint}</p>}
    </div>
  );
}

export { PinInput };

const fade = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -6 }, transition: { duration: 0.25, ease: EASE } };
const reveal = { initial: { opacity: 0, height: 0 }, animate: { opacity: 1, height: "auto" }, exit: { opacity: 0, height: 0 }, transition: { duration: 0.25, ease: EASE } };

// A username suggestion from a name: "Vicky Rao" -> "vickyrao_4821".
export function suggestUsername(name: string) {
  let base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "").slice(0, 20);
  if (!/^[a-z]/.test(base)) base = "user" + base;
  return base.slice(0, 20) + "_" + String(Math.floor(1000 + Math.random() * 9000));
}
export const USERNAME_RE = /^[a-z][a-z0-9_.]{2,29}$/;
const cleanUsername = (v: string) => v.trim().replace(/^@/, "").toLowerCase();

// Live "is this username free?" check, a moment after typing stops.
export function useUsernameCheck(value: string) {
  const [state, setState] = React.useState<"idle" | "checking" | "free" | "taken" | "invalid">("idle");
  React.useEffect(() => {
    const u = cleanUsername(value);
    if (!u) { setState("idle"); return; }
    if (!USERNAME_RE.test(u)) { setState("invalid"); return; }
    setState("checking");
    const t = setTimeout(() => {
      get<{ available: boolean }>("/api/auth/username?u=" + encodeURIComponent(u))
        .then(d => setState(d.available ? "free" : "taken")).catch(() => setState("idle"));
    }, 350);
    return () => clearTimeout(t);
  }, [value]);
  return state;
}
export function UsernameHint({ state }: { state: ReturnType<typeof useUsernameCheck> }) {
  if (state === "idle") return <span>Letters, numbers, _ or . (3–30), starting with a letter. People find you by it.</span>;
  if (state === "checking") return <span>Checking…</span>;
  if (state === "invalid") return <span className="text-negative">3–30 characters: letters, numbers, _ or ., starting with a letter.</span>;
  return state === "free"
    ? <span className="inline-flex items-center gap-1 text-positive"><Check className="size-3.5" strokeWidth={2.6} />Available</span>
    : <span className="inline-flex items-center gap-1 text-negative"><X className="size-3.5" strokeWidth={2.6} />Taken. Try another.</span>;
}

// After the first try, the server may ask for a password: "create" for
// accounts from before PINs, "choose" for the old administrator (who proved
// who they are with the old admin PIN).
type PwStep = null | "create" | "choose";

export function AuthScreen() {
  const qc = useQueryClient();
  const [tab, setTab] = React.useState<"signin" | "signup">("signin");
  // legacy: "used Split It before accounts" — group name + your name.
  const [legacy, setLegacy] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const install = useInstallApp();
  const [pwStep, setPwStep] = React.useState<PwStep>(null);
  const [form, setForm] = React.useState({ login: "", password: "", group: "", name: "", next: "", next2: "", suName: "", suUsername: "", suEmail: "", suPassword: "", suPassword2: "" });
  const [usernameTouched, setUsernameTouched] = React.useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement> | string) => setForm(f => ({ ...f, [k]: typeof e === "string" ? e : e.target.value }));
  const usernameState = useUsernameCheck(form.suUsername);
  const resetStep = () => { setPwStep(null); setForm(f => ({ ...f, next: "", next2: "" })); };

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
  const google = (credential: string) => run(async () => {
    const d = await post<{ created: boolean }>("/api/auth/google", { credential });
    await signedIn(d.created ? "Account created with Google. Welcome!" : "Welcome back.");
  });

  const signIn = () => run(async () => {
    if (pwStep && form.next !== form.next2) throw new Error("The two passwords don't match.");
    if (pwStep && !goodPassword(form.next)) throw new Error(PASSWORD_HINT);
    const extra = pwStep === "create" ? { password: form.next, createPassword: true } : pwStep === "choose" ? { newPassword: form.next } : {};
    try {
      if (legacy) await post("/api/auth/legacy-signin", { group: form.group.trim(), name: form.name.trim(), password: form.password, ...extra });
      else await post("/api/auth/signin", { login: form.login.trim(), password: form.password, ...extra });
    } catch (err) {
      if (err instanceof ApiError && (err.code === "password_not_set" || err.code === "choose_password")) { setPwStep(err.code === "password_not_set" ? "create" : "choose"); setForm(f => ({ ...f, next: "", next2: "" })); return; }
      throw err;
    }
    setForm(f => ({ ...f, password: "", next: "", next2: "" }));
    await signedIn(pwStep ? "Password saved. Welcome back." : "Welcome back.");
    setPwStep(null);
  });

  const ready = (pwStep === "create" || form.password.length > 0) && (!pwStep || (form.next.length > 0 && form.next2.length > 0));

  return (
    <div className="min-h-dvh overflow-x-clip">
      <div className="mx-auto flex min-h-dvh max-w-md flex-col px-4 pt-[max(3rem,env(safe-area-inset-top))] pb-10">
        <m.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.45, ease: EASE }} className="flex flex-col items-center text-center">
          <Wordmark large />
          <h1 className="mt-5 text-[32px] leading-[38px] font-medium tracking-[-0.03em]">Split It</h1>
          <p className="mt-2 max-w-[30ch] text-[15px] text-muted-foreground">Split it. Settle it. Every rupee accounted for.</p>
        </m.div>

        <m.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: EASE, delay: 0.08 }} className="mt-9">
          {/^#\/join\//.test(location.hash) && (
            <p className="mb-4 rounded-[16px] bg-tint-soft px-4 py-3 text-center text-[14px] leading-5 text-tint" data-testid="join-signin-note">You've opened a group invite. Sign in or create an account, and we'll take you to it.</p>
          )}
          <Segmented id="auth-tab" value={tab} onChange={v => { setTab(v); resetStep(); }} options={[{ value: "signin", label: "Sign in" }, { value: "signup", label: "Create account" }]} />

          <div className="panel mt-4 p-5">
            {!legacy && <GoogleSection onToken={google} text={tab === "signup" ? "signup_with" : "continue_with"} />}
            <AnimatePresence mode="wait" initial={false}>
              {tab === "signin" ? (
                <m.form key={legacy ? "legacy" : "signin"} {...fade} className="space-y-5" onSubmit={e => { e.preventDefault(); signIn(); }}>
                  {legacy ? (
                    <>
                      <p className="rounded-[14px] bg-tint-soft px-3.5 py-3 text-[13.5px] leading-5 text-tint">Split It now has accounts. Sign in once with your group and name, then pick a username in your profile.</p>
                      <Field label="Group name" htmlFor="legacy-group">
                        <Input id="legacy-group" required autoComplete="off" placeholder="e.g. Goa Trip" value={form.group} onChange={e => { set("group")(e); resetStep(); }} className={fieldClass} />
                      </Field>
                      <Field label="Your name in it" htmlFor="legacy-name">
                        <Input id="legacy-name" required autoComplete="name" placeholder="As the group knows you" value={form.name} onChange={e => { set("name")(e); resetStep(); }} className={fieldClass} />
                      </Field>
                    </>
                  ) : (
                    <Field label="Username or email" htmlFor="signin-login">
                      <Input id="signin-login" required autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="vicky or vicky@mail.com" value={form.login} onChange={e => { set("login")(e); resetStep(); }} className={fieldClass} />
                    </Field>
                  )}
                  {pwStep !== "create" && (
                    <Field label="Password" htmlFor="signin-password" hint={legacy ? "Your password (your old 4-digit PIN works). If you were the administrator, your admin PIN." : "Used Split It with a 4-digit PIN? That PIN is your password."}>
                      <PasswordInput id="signin-password" value={form.password} onChange={set("password")} placeholder="Password" />
                    </Field>
                  )}
                  <AnimatePresence initial={false}>
                    {pwStep && (
                      <m.div {...reveal} className="space-y-4 overflow-hidden">
                        <p className="px-1 text-[13.5px] text-muted-foreground">{pwStep === "create" ? "Your account has no password yet. Choose one only you know." : "One last step: choose a password. You'll sign in with it from now on."}</p>
                        <Field label="New password" htmlFor="new-password"><PasswordInput id="new-password" value={form.next} onChange={set("next")} autoComplete="new-password" placeholder="New password" autoFocus /></Field>
                        <Field label="Confirm password" htmlFor="new-password2"><PasswordInput id="new-password2" value={form.next2} onChange={set("next2")} autoComplete="new-password" placeholder="Type it again" /></Field>
                        <p className="footnote px-1 text-muted-foreground"><PasswordStrength value={form.next} /></p>
                      </m.div>
                    )}
                  </AnimatePresence>
                  <LoadingButton type="submit" size="xl" className="w-full" disabled={!ready} loading={busy} loadingText="Signing in…">{pwStep ? "Save password and sign in" : "Sign in"}</LoadingButton>
                  <button type="button" onClick={() => { setLegacy(l => !l); resetStep(); }} className="mx-auto block cursor-pointer text-center text-[14px] font-medium text-tint">
                    {legacy ? "Sign in with username or email" : "Used Split It before? Sign in with your group"}
                  </button>
                </m.form>
              ) : (
                <m.form key="signup" {...fade} className="space-y-5" onSubmit={e => { e.preventDefault(); run(async () => {
                  if (form.suPassword !== form.suPassword2) throw new Error("The two passwords don't match.");
                  await post("/api/auth/signup", { name: form.suName.trim(), username: cleanUsername(form.suUsername), email: form.suEmail.trim() || undefined, password: form.suPassword });
                  setForm(f => ({ ...f, suPassword: "", suPassword2: "" }));
                  await signedIn("Account created. Welcome!");
                }); }}>
                  <Field label="Your name" htmlFor="su-name">
                    <Input id="su-name" required minLength={2} maxLength={60} autoComplete="name" placeholder="Full name" value={form.suName}
                      onChange={e => { const v = e.target.value; setForm(f => ({ ...f, suName: v, suUsername: usernameTouched ? f.suUsername : v.trim() ? suggestUsername(v) : "" })); }} className={fieldClass} />
                  </Field>
                  <Field label="Username" htmlFor="su-username">
                    <Input id="su-username" required autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="vicky_2024" value={form.suUsername}
                      onChange={e => { setUsernameTouched(true); set("suUsername")(e); }} className={fieldClass} />
                    <p className="footnote mt-2 px-1 text-muted-foreground"><UsernameHint state={usernameState} /></p>
                  </Field>
                  <Field label="Email (optional)" htmlFor="su-email" hint="Friends can invite you by email too.">
                    <Input id="su-email" type="email" autoComplete="email" autoCapitalize="none" placeholder="you@mail.com" value={form.suEmail} onChange={set("suEmail")} className={fieldClass} />
                  </Field>
                  <Field label="Password" htmlFor="su-password"><PasswordInput id="su-password" value={form.suPassword} onChange={set("suPassword")} autoComplete="new-password" placeholder="Choose a password" /></Field>
                  <div>
                    <Field label="Confirm password" htmlFor="su-password2"><PasswordInput id="su-password2" value={form.suPassword2} onChange={set("suPassword2")} autoComplete="new-password" placeholder="Type it again" /></Field>
                    <p className="footnote mt-2 px-1 text-muted-foreground"><PasswordStrength value={form.suPassword} /></p>
                  </div>
                  <LoadingButton type="submit" size="xl" className="w-full" disabled={!goodPassword(form.suPassword) || !form.suPassword2 || usernameState === "taken" || usernameState === "invalid"} loading={busy} loadingText="Creating account…">Create account</LoadingButton>
                </m.form>
              )}
            </AnimatePresence>
          </div>
        </m.div>
        {install.available && (
          <button type="button" onClick={() => install.start()} className="mx-auto mt-6 inline-flex cursor-pointer items-center gap-2 rounded-full bg-white px-4 py-2.5 text-[14px] font-medium shadow-[0_1px_2px_rgb(16_40_32/6%)] ring-1 ring-[#141716]/[0.06] transition-transform active:scale-95">
            <Download className="size-4" />Install the app
          </button>
        )}
        {install.dialog}
        <p className="footnote mt-auto pt-10 text-center text-muted-foreground">Amounts are kept to the exact paisa.<span className="mt-1 block text-[11px] opacity-60">Build {__BUILD__}</span></p>
      </div>
    </div>
  );
}

// "Continue with Google", then "or" above the form. Hidden until Google
// sign-in is set up on the server.
function GoogleSection({ onToken, text }: { onToken: (t: string) => void; text: "continue_with" | "signup_with" }) {
  const clientId = useGoogleClientId().data;
  if (!clientId) return null;
  return (
    <div className="mb-5">
      <GoogleButton onToken={onToken} text={text} />
      <div className="mt-5 flex items-center gap-3 text-[12.5px] text-muted-foreground"><span className="h-px flex-1 bg-hairline" />or<span className="h-px flex-1 bg-hairline" /></div>
    </div>
  );
}
