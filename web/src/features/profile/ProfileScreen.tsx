import * as React from "react";
import { AtSign, ChevronRight, KeyRound, Link2, Wallet } from "lucide-react";
import { Input } from "@/components/ui/input";
import { LoadingButton, Page, PersonAvatar, SectionTitle, Segmented, fieldClass, pressableRow } from "@/components/app/bits";
import { Field, USERNAME_RE, UsernameHint, useUsernameCheck } from "@/features/auth/AuthScreen";
import { GoogleButton, PasswordInput, PasswordStrength, goodPassword, useAuthConfig, useGoogleClientId } from "@/components/app/secrets";
import { BadgeCheck } from "lucide-react";
import { BackButton } from "@/features/groups/GroupScreen";
import { PaymentMethodSheet } from "@/features/groups/UpiPayments";
import { useAccountAction, useMyPaymentMethod } from "@/hooks/queries";
import { post, type User } from "@/lib/api";
import { goBack } from "@/lib/route";

// Your account: name, username, email, how people pay you, PIN, and linking
// a second account you had before (one per group, from before accounts).
export function ProfileScreen({ user }: { user: User }) {
  const [upiOpen, setUpiOpen] = React.useState(false);
  const upi = useMyPaymentMethod();
  return (
    <Page>
      <BackButton label="Home" onClick={() => goBack({ name: "home" })} />
      <div className="mt-4 flex items-center gap-4 px-1">
        <PersonAvatar id={user.id} name={user.name} size="lg" />
        <div className="min-w-0">
          <h1 className="page-title truncate">{user.name}</h1>
          <p className="truncate text-[15px] text-muted-foreground">@{user.username}{user.email ? " · " + user.email : ""}</p>
        </div>
      </div>
      {user.legacy && (
        <p className="mt-5 rounded-[16px] bg-tint-soft px-4 py-3 text-[14px] leading-5 text-tint" data-testid="choose-username">
          <b className="font-semibold">Choose your username.</b> You got <b className="font-semibold">@{user.username}</b> automatically. Pick one you'll remember: you'll sign in with it, and friends find you by it.
        </p>
      )}
      <DetailsForm user={user} />

      <section className="mt-7">
        <SectionTitle>Get paid</SectionTitle>
        <div className="panel overflow-hidden">
          <button type="button" onClick={() => setUpiOpen(true)} className={pressableRow}>
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#141716]/[0.05]"><Wallet className="size-5" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-medium">Your UPI</span>
              <span className="block truncate text-[13px] text-muted-foreground">{upi.data?.upiId ? upi.data.upiId + (upi.data.hasQr ? " · QR added" : "") : "Add your UPI ID and QR. Everyone in your groups sees it."}</span>
            </span>
            <ChevronRight className="size-[18px] text-[#141716]/25" strokeWidth={2.4} />
          </button>
        </div>
      </section>
      <PaymentMethodSheet open={upiOpen} onOpenChange={setUpiOpen} />

      <ChangePassword hasPin={user.hasPin} />
      <GoogleAccount user={user} />
      <LinkAccount />
    </Page>
  );
}

function DetailsForm({ user }: { user: User }) {
  const [form, setForm] = React.useState({ name: user.name, username: user.username, email: user.email || "" });
  React.useEffect(() => { setForm({ name: user.name, username: user.username, email: user.email || "" }); }, [user.name, user.username, user.email]);
  const username = form.username.trim().replace(/^@/, "").toLowerCase();
  const check = useUsernameCheck(username === user.username ? "" : form.username);
  const save = useAccountAction((b: Partial<{ name: string; username: string; email: string }>) => post("/api/me/profile", b), () => "Profile saved.");
  const nameChanged = form.name.trim() !== user.name, usernameChanged = username !== user.username, emailChanged = form.email.trim().toLowerCase() !== (user.email || "");
  // Saving the username, even unchanged, confirms it for accounts from before usernames.
  const changes = { ...(nameChanged && { name: form.name.trim() }), ...((usernameChanged || user.legacy) && { username }), ...(emailChanged && { email: form.email.trim() }) };
  const dirty = nameChanged || usernameChanged || emailChanged || user.legacy;
  const ok = form.name.trim().length >= 2 && USERNAME_RE.test(username) && check !== "taken";
  return (
    <form className="panel mt-6 space-y-5 p-5" onSubmit={e => { e.preventDefault(); if (dirty && ok) save.mutate(changes); }}>
      <Field label="Name" htmlFor="profile-name" hint="Shows in all your groups, on past expenses too.">
        <Input id="profile-name" required minLength={2} maxLength={60} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={fieldClass} />
      </Field>
      <Field label="Username" htmlFor="profile-username">
        <div className="relative">
          <AtSign className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input id="profile-username" required autoCapitalize="none" spellCheck={false} value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} className={fieldClass + " pl-10"} />
        </div>
        <p className="footnote mt-2 px-1 text-muted-foreground">{username === user.username ? (user.legacy ? "Keep it, or type a new one, then save." : "You sign in with this. Friends find you by it.") : <UsernameHint state={check} />}</p>
      </Field>
      <Field label="Email (optional)" htmlFor="profile-email" hint="You can sign in with it, and friends can invite you by it.">
        <Input id="profile-email" type="email" autoCapitalize="none" placeholder="you@mail.com" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className={fieldClass} />
        {user.email && !emailChanged && <EmailStatus user={user} />}
      </Field>
      <LoadingButton type="submit" className="w-full rounded-full" size="lg" disabled={!dirty || !ok} loading={save.isPending} loadingText="Saving…">{user.legacy && username === user.username ? "Keep this username" : "Save changes"}</LoadingButton>
    </form>
  );
}

function ChangePassword({ hasPin }: { hasPin: boolean }) {
  const [f, setF] = React.useState({ current: "", next: "", again: "" });
  const change = useAccountAction(() => {
    if (f.next !== f.again) return Promise.reject(new Error("The two new passwords don't match."));
    return post("/api/me/password", { currentPassword: f.current, newPassword: f.next });
  }, () => hasPin ? "Password changed." : "Password added.");
  return (
    <section className="mt-7">
      <SectionTitle>Password</SectionTitle>
      <form className="panel space-y-4 p-5" onSubmit={e => { e.preventDefault(); change.mutate(undefined, { onSuccess: () => setF({ current: "", next: "", again: "" }) }); }}>
        <p className="flex items-center gap-2 text-[14px] text-muted-foreground"><KeyRound className="size-4 shrink-0" />{hasPin ? "You sign in with your username or email and this password." : "You sign in with Google. Add a password to also sign in with your username."}</p>
        {hasPin && <Field label="Current password" htmlFor="pw-current"><PasswordInput id="pw-current" value={f.current} onChange={v => setF(x => ({ ...x, current: v }))} placeholder="Current password" /></Field>}
        <Field label="New password" htmlFor="pw-new"><PasswordInput id="pw-new" value={f.next} onChange={v => setF(x => ({ ...x, next: v }))} autoComplete="new-password" placeholder="New password" /></Field>
        <div>
          <Field label="Confirm new password" htmlFor="pw-again"><PasswordInput id="pw-again" value={f.again} onChange={v => setF(x => ({ ...x, again: v }))} autoComplete="new-password" placeholder="Type it again" /></Field>
          <p className="footnote mt-2 px-1 text-muted-foreground"><PasswordStrength value={f.next} /></p>
        </div>
        <LoadingButton type="submit" variant="secondary" className="w-full rounded-full" disabled={(hasPin && !f.current) || !goodPassword(f.next) || !f.again} loading={change.isPending} loadingText="Saving…">{hasPin ? "Change password" : "Add password"}</LoadingButton>
      </form>
    </section>
  );
}

// Connect Google to sign in with it; disconnect needs a password.
function GoogleAccount({ user }: { user: User }) {
  const clientId = useGoogleClientId().data;
  const connect = useAccountAction((credential: string) => post("/api/me/google", { credential }), () => "Google connected. You can sign in with it now.");
  const disconnect = useAccountAction(() => post("/api/me/google/disconnect"), () => "Google disconnected.");
  if (!clientId && !user.google) return null;
  return (
    <section className="mt-7">
      <SectionTitle>Google</SectionTitle>
      <div className="panel space-y-4 p-5">
        {user.google ? (
          <>
            <p className="text-[14px] text-muted-foreground">Google is connected: you can sign in with it.</p>
            <LoadingButton variant="secondary" className="w-full rounded-full" disabled={!user.hasPin} loading={disconnect.isPending} loadingText="Disconnecting…" onClick={() => disconnect.mutate(undefined)}>Disconnect Google</LoadingButton>
            {!user.hasPin && <p className="text-[12.5px] text-muted-foreground">Add a password first, so you can still sign in without Google.</p>}
          </>
        ) : (
          <>
            <p className="text-[14px] text-muted-foreground">Connect your Google account to sign in with one tap.</p>
            <GoogleButton onToken={t => connect.mutate(t)} text="continue_with" />
          </>
        )}
      </div>
    </section>
  );
}

// Before accounts, each group had its own member entry, so one person could
// have several. Proving the other one's PIN moves it all into this account.
function LinkAccount() {
  const [by, setBy] = React.useState<"username" | "group">("group");
  const [f, setF] = React.useState({ login: "", group: "", name: "", pin: "" });
  const link = useAccountAction(() => post<{ merged: string }>("/api/me/link", by === "username" ? { login: f.login.trim(), password: f.pin } : { group: f.group.trim(), name: f.name.trim(), password: f.pin }),
    () => "Linked. Its groups, expenses and payments are now in this account.");
  return (
    <section className="mt-7">
      <SectionTitle>Had another account?</SectionTitle>
      <form className="panel space-y-4 p-5" onSubmit={e => { e.preventDefault(); link.mutate(undefined, { onSuccess: () => setF({ login: "", group: "", name: "", pin: "" }) }); }}>
        <p className="flex gap-2 text-[14px] text-muted-foreground"><Link2 className="mt-0.5 size-4 shrink-0" />If you were in another group under a separate sign-in, link it here. Its groups, expenses and payments move into this account and the other one is closed. Balances stay exactly the same.</p>
        <Segmented id="link-by" value={by} onChange={setBy} options={[{ value: "group", label: "Group + name" }, { value: "username", label: "Username" }]} />
        {by === "username" ? (
          <Field label="Its username or email" htmlFor="link-login"><Input id="link-login" required autoCapitalize="none" value={f.login} onChange={e => setF(x => ({ ...x, login: e.target.value }))} className={fieldClass} /></Field>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Group name" htmlFor="link-group"><Input id="link-group" required value={f.group} onChange={e => setF(x => ({ ...x, group: e.target.value }))} className={fieldClass} /></Field>
            <Field label="Name in it" htmlFor="link-name"><Input id="link-name" required value={f.name} onChange={e => setF(x => ({ ...x, name: e.target.value }))} className={fieldClass} /></Field>
          </div>
        )}
        <Field label="Its password (or old PIN)" htmlFor="link-pin"><PasswordInput id="link-pin" value={f.pin} onChange={v => setF(x => ({ ...x, pin: v }))} autoComplete="off" placeholder="That account's password" /></Field>
        <LoadingButton type="submit" variant="secondary" className="w-full rounded-full" disabled={!f.pin} loading={link.isPending} loadingText="Linking…">Link account</LoadingButton>
      </form>
    </section>
  );
}

// Whether my email is confirmed (needed for "Forgot password?"), with a
// button to send the confirmation link again.
function EmailStatus({ user }: { user: User }) {
  const enabled = useAuthConfig().data?.emailEnabled;
  const send = useAccountAction(() => post<{ sentTo?: string }>("/api/me/email/verify"), () => `Link sent to ${user.email}. Check spam too.`);
  if (user.emailVerified) return <p className="mt-2 flex items-center gap-1 px-1 text-[13px] text-positive"><BadgeCheck className="size-4" />Confirmed. You can reset your password with it.</p>;
  if (!enabled) return null;
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-[13px] text-muted-foreground" data-testid="email-unconfirmed">
      Not confirmed yet, so it can't reset your password.
      <button type="button" disabled={send.isPending} onClick={() => send.mutate(undefined)} className="cursor-pointer font-medium text-tint disabled:opacity-50">{send.isPending ? "Sending…" : "Send confirmation link"}</button>
    </p>
  );
}
