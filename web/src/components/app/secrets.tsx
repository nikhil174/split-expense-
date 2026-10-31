import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Lock } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { LoadingButton, fieldClass } from "@/components/app/bits";
import { get, post } from "@/lib/api";
import { cn } from "@/lib/utils";

// Four-digit PIN box: digits only, masked, numeric keypad on phones.
export function PinInput({ id, value, onChange, autoComplete = "current-password", autoFocus }: { id: string; value: string; onChange: (v: string) => void; autoComplete?: string; autoFocus?: boolean }) {
  return (
    <Input id={id} type="password" inputMode="numeric" pattern="[0-9]{4}" minLength={4} maxLength={4} required autoComplete={autoComplete} autoFocus={autoFocus}
      placeholder="••••" value={value} onChange={e => onChange(e.target.value.replace(/\D/g, "").slice(0, 4))}
      className={cn(fieldClass, "tabular text-center text-[22px] tracking-[0.6em] placeholder:tracking-[0.6em]")} />
  );
}

// ----- Passwords -----
// Same rule as the server: 8–128 characters with letters and numbers.
export const PASSWORD_HINT = "At least 8 characters, with letters and numbers.";
export const goodPassword = (p: string) => p.length >= 8 && p.length <= 128 && /[A-Za-z]/.test(p) && /\d/.test(p);

export function PasswordInput({ id, value, onChange, autoComplete = "current-password", placeholder = "Password", autoFocus, label }: {
  id: string; value: string; onChange: (v: string) => void; autoComplete?: string; placeholder?: string; autoFocus?: boolean; label?: string;
}) {
  const [show, setShow] = React.useState(false);
  return (
    <div className="relative">
      <Input id={id} aria-label={label} type={show ? "text" : "password"} required autoComplete={autoComplete} autoCapitalize="none" spellCheck={false} autoFocus={autoFocus}
        placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} className={cn(fieldClass, "pr-12")} />
      <button type="button" onClick={() => setShow(s => !s)} aria-label={show ? "Hide password" : "Show password"}
        className="absolute top-1/2 right-2 grid size-9 -translate-y-1/2 cursor-pointer place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground">
        {show ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
      </button>
    </div>
  );
}
export function PasswordStrength({ value }: { value: string }) {
  if (!value) return <span>{PASSWORD_HINT}</span>;
  return goodPassword(value) ? <span className="text-positive">Good password.</span> : <span className="text-negative">{PASSWORD_HINT}</span>;
}

// ----- Group PIN -----
// A group's 4-digit PIN is asked when opening it; the server remembers it for
// a day on this device. Anything that hits a locked group (e.g. confirming a
// payment from Home) opens this prompt through openGroupPin.
type Locked = { groupId: string; groupName: string } | null;
let locked: Locked = null;
const listeners = new Set<() => void>();
export function openGroupPin(g: Locked) { locked = g; listeners.forEach(l => l()); }
const useLocked = () => React.useSyncExternalStore(cb => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => locked);

export function GroupPinForm({ groupId, groupName, onDone, autoFocus = true }: { groupId: string; groupName: string; onDone?: () => void; autoFocus?: boolean }) {
  const qc = useQueryClient();
  const [pin, setPin] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (pin.length !== 4 || busy) return;
    setBusy(true); setError("");
    try {
      await post(`/api/groups/${encodeURIComponent(groupId)}/unlock`, { pin });
      await Promise.all([qc.invalidateQueries({ queryKey: ["group", groupId] }), qc.invalidateQueries({ queryKey: ["groups"] })]);
      onDone?.();
    } catch (err) { setError((err as Error).message); setPin(""); }
    finally { setBusy(false); }
  };
  // Submit as soon as the 4th digit is typed.
  React.useEffect(() => { if (pin.length === 4) submit(); }, [pin]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <form onSubmit={submit} className="space-y-4" data-testid="group-pin-form">
      <PinInput id={"group-pin-" + groupId} value={pin} onChange={v => { setPin(v); setError(""); }} autoComplete="off" autoFocus={autoFocus} />
      {error && <p role="alert" className="text-center text-[13.5px] text-negative">{error}</p>}
      <LoadingButton type="submit" size="lg" className="w-full rounded-full" disabled={pin.length !== 4} loading={busy} loadingText="Opening…">Open {groupName}</LoadingButton>
      <p className="text-center text-[12.5px] text-muted-foreground">Ask a group admin if you don't know it. It's remembered on this device for a day.</p>
    </form>
  );
}

export function GroupPinDialog() {
  const g = useLocked();
  return (
    <AlertDialog open={!!g} onOpenChange={o => { if (!o) openGroupPin(null); }}>
      <AlertDialogContent className="max-w-[360px] rounded-[26px] border-0 p-6">
        <AlertDialogHeader>
          <span className="mx-auto grid size-12 place-items-center rounded-full bg-[#141716] text-white"><Lock className="size-5" /></span>
          <AlertDialogTitle className="title-2 text-center">{g?.groupName}</AlertDialogTitle>
          <AlertDialogDescription className="text-center">Enter the group's 4-digit PIN to open it.</AlertDialogDescription>
        </AlertDialogHeader>
        {g && <GroupPinForm groupId={g.groupId} groupName={g.groupName} onDone={() => { openGroupPin(null); toast.success(`${g.groupName} is open. Try that again.`); }} />}
        <AlertDialogFooter><AlertDialogCancel className="w-full rounded-full border-0 bg-[#141716]/[0.06] shadow-none">Cancel</AlertDialogCancel></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ----- Sign in with Google -----
// Google Identity Services draws its own button; tapping it gives us an ID
// token, which the server checks. Hidden until GOOGLE_CLIENT_ID is set.
type GoogleId = { initialize: (o: object) => void; renderButton: (el: HTMLElement, o: object) => void };
declare global { interface Window { google?: { accounts: { id: GoogleId } } } }
let gisLoading: Promise<void> | null = null;
const loadGis = () => gisLoading ??= new Promise((resolve, reject) => {
  const s = document.createElement("script");
  s.src = "https://accounts.google.com/gsi/client"; s.async = true;
  s.onload = () => resolve(); s.onerror = () => { gisLoading = null; reject(new Error("Couldn't load Google sign-in.")); };
  document.head.appendChild(s);
});
let onCredential: (token: string) => void = () => {};
let initializedFor = "";
export const useGoogleClientId = () => useQuery({ queryKey: ["auth-config"], queryFn: () => get<{ googleClientId: string | null }>("/api/auth/config").then(d => d.googleClientId), staleTime: Infinity });

export function GoogleButton({ onToken, text = "continue_with" }: { onToken: (token: string) => void; text?: "continue_with" | "signin_with" | "signup_with" }) {
  const clientId = useGoogleClientId().data;
  const ref = React.useRef<HTMLDivElement>(null);
  const [failed, setFailed] = React.useState(false);
  onCredential = onToken;
  React.useEffect(() => {
    if (!clientId || !ref.current) return;
    let live = true;
    loadGis().then(() => {
      const id = window.google?.accounts.id;
      if (!live || !id || !ref.current) return;
      if (initializedFor !== clientId) { id.initialize({ client_id: clientId, callback: (r: { credential: string }) => onCredential(r.credential), ux_mode: "popup", itp_support: true }); initializedFor = clientId; }
      id.renderButton(ref.current, { theme: "outline", size: "large", shape: "pill", text, width: Math.min(360, ref.current.clientWidth || 320), logo_alignment: "center" });
    }).catch(() => setFailed(true));
    return () => { live = false; };
  }, [clientId, text]);
  if (!clientId) return null;
  if (failed) return <p className="text-center text-[13px] text-muted-foreground">Google sign-in couldn't load. Check your connection.</p>;
  return <div ref={ref} className="flex min-h-11 w-full justify-center" data-testid="google-button" />;
}
