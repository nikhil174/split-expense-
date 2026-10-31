import * as React from "react";
import { m } from "motion/react";
import { Bell, BellOff, BellRing, Check, HandCoins, Pencil, ReceiptText, Smartphone, Trash2, UserPlus, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, List, Page, SectionTitle, listItem, pressableRow } from "@/components/app/bits";
import { BackButton } from "@/features/groups/GroupScreen";
import { useMarkNotificationsRead, useNotifications } from "@/hooks/queries";
import type { AppNotification } from "@/lib/api";
import { goBack } from "@/lib/route";
import { disablePush, enablePush, pushState, type PushState } from "@/lib/push";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const ICON: Record<string, { icon: React.ReactNode; tone: string }> = {
  expense_added: { icon: <ReceiptText />, tone: "bg-[#141716]/[0.05] text-foreground" },
  expense_edited: { icon: <Pencil />, tone: "bg-[#141716]/[0.05] text-foreground" },
  expense_deleted: { icon: <Trash2 />, tone: "bg-negative-soft text-negative" },
  payment_pending: { icon: <HandCoins />, tone: "bg-[#e4c06c]/25 text-[#8a6416]" },
  payment_recorded: { icon: <HandCoins />, tone: "bg-[#141716]/[0.05] text-foreground" },
  payment_confirmed: { icon: <Check />, tone: "bg-positive-soft text-positive" },
  payment_rejected: { icon: <X />, tone: "bg-negative-soft text-negative" },
  payment_cancelled: { icon: <X />, tone: "bg-[#141716]/[0.05] text-muted-foreground" },
  approved: { icon: <Check />, tone: "bg-positive-soft text-positive" },
  access_request: { icon: <UserPlus />, tone: "bg-[#e4c06c]/25 text-[#8a6416]" },
  group_invite: { icon: <UserPlus />, tone: "bg-[#e4c06c]/25 text-[#8a6416]" },
  member_joined: { icon: <UserPlus />, tone: "bg-positive-soft text-positive" },
  made_admin: { icon: <Check />, tone: "bg-tint-soft text-tint" },
  removed: { icon: <X />, tone: "bg-[#141716]/[0.05] text-muted-foreground" },
  join_request: { icon: <UserPlus />, tone: "bg-[#e4c06c]/25 text-[#8a6416]" },
  member_suggested: { icon: <UserPlus />, tone: "bg-[#e4c06c]/25 text-[#8a6416]" },
  friend_request: { icon: <UserPlus />, tone: "bg-tint-soft text-tint" },
  friend_accepted: { icon: <Check />, tone: "bg-positive-soft text-positive" },
  group_pin: { icon: <Check />, tone: "bg-[#141716]/[0.05] text-foreground" },
};

function ago(ts: number) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return new Date(ts).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

// Everything that happened involving me, newest first. Opening the screen
// marks it all read; what was new stays highlighted until I leave.
export function NotificationsScreen() {
  const q = useNotifications();
  const markRead = useMarkNotificationsRead();
  // What was unread when the screen opened (kept while it is open).
  const [fresh, setFresh] = React.useState<Set<string> | null>(null);
  React.useEffect(() => {
    if (!q.data || fresh) return;
    setFresh(new Set(q.data.items.filter(n => !n.readAt).map(n => n.id)));
    if (q.data.unread) markRead.mutate();
  }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const items = q.data?.items || [];
  const isNew = (n: AppNotification) => fresh?.has(n.id) ?? !n.readAt;
  const sections = [
    { title: "New", list: items.filter(isNew) },
    { title: "Earlier", list: items.filter(n => !isNew(n)) },
  ].filter(s => s.list.length);
  const open = (n: AppNotification) => { if (n.link) location.hash = n.link.replace(/^#/, ""); };

  return (
    <Page>
      <BackButton label="Home" onClick={() => goBack({ name: "home" })} />
      <h1 className="page-title mt-4 px-1">Notifications</h1>
      <PhoneNotifications />
      <div className="mt-5 space-y-6">
        {q.isPending ? (
          <List inset={68}>{[0, 1, 2].map(i => <div key={i} className="flex items-center gap-3 px-4 py-3.5"><Skeleton className="size-10 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-48" /><Skeleton className="h-3 w-32" /></div></div>)}</List>
        ) : !items.length ? (
          <div className="panel"><EmptyState icon={<Bell />} title="No notifications yet">When someone adds an expense with you, pays you, or confirms your payment, it shows up here.</EmptyState></div>
        ) : sections.map(sec => (
          <section key={sec.title}>
            <SectionTitle>{sec.title}</SectionTitle>
            <List inset={68}>
              {sec.list.map((n, i) => {
                const look = ICON[n.kind] || ICON.expense_added;
                return (
                  <m.button key={n.id} custom={i} variants={listItem} initial="initial" animate="animate" type="button" onClick={() => open(n)}
                    className={cn(pressableRow, "items-start", sec.title === "New" && "bg-[#e4c06c]/[0.07]")}>
                    <span className={cn("mt-0.5 grid size-10 shrink-0 place-items-center rounded-full [&_svg]:size-[18px]", look.tone)}>{look.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] leading-snug font-medium">{n.title}</span>
                      {n.body && <span className="mt-0.5 block text-[13.5px] leading-snug text-muted-foreground">{n.body}</span>}
                      <span className="mt-1 block text-[12px] text-muted-foreground/80">{[n.groupName, ago(n.createdAt)].filter(Boolean).join(" · ")}</span>
                    </span>
                    {sec.title === "New" && <span aria-label="New" className="mt-2 size-2 shrink-0 rounded-full bg-[#c99a3e]" />}
                  </m.button>
                );
              })}
            </List>
          </section>
        ))}
      </div>
    </Page>
  );
}

// "Phone notifications" switch: shows what is possible on this device and
// turns pushes on/off for this browser.
function PhoneNotifications() {
  const [state, setState] = React.useState<PushState | "loading">("loading");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { pushState().then(setState).catch(() => setState("unsupported")); }, []);
  const turnOn = async () => {
    setBusy(true);
    try {
      const s = await enablePush();
      setState(s);
      if (s === "on") toast.success("Phone notifications are on for this device.");
      else if (s === "blocked") toast.error("Notifications are blocked for this site. Allow them in your browser settings.");
    } catch (e) {
      // e.g. a browser without a push service ("Registration failed").
      toast.error("This browser couldn't turn on notifications.", { description: "Use Chrome on Android, or the installed app on iPhone. " + ((e as Error).message || "") });
    }
    finally { setBusy(false); }
  };
  const turnOff = async () => { setBusy(true); try { setState(await disablePush()); toast.success("Phone notifications are off for this device."); } finally { setBusy(false); } };
  if (state === "loading" || state === "not-set-up" || state === "unsupported") return null;
  const text: Record<string, [string, string]> = {
    on: ["Phone notifications are on", "You'll get a notification on this device, like any other app."],
    off: ["Get phone notifications", "Know right away when someone adds an expense with you or pays you."],
    blocked: ["Notifications are blocked", "Allow notifications for this site in your browser or phone settings, then come back."],
    "install-first": ["Get phone notifications on iPhone", "Install the app first (Share → Add to Home Screen), open it from your home screen, then turn them on here."],
  };
  const [title, body] = text[state];
  return (
    <div className={cn("panel mt-5 flex items-center gap-3 p-4", state === "on" && "bg-positive-soft/40")} data-testid="phone-notifications">
      <span className={cn("grid size-10 shrink-0 place-items-center rounded-full [&_svg]:size-[18px]", state === "on" ? "bg-positive-soft text-positive" : "bg-[#141716]/[0.05]")}>
        {state === "on" ? <BellRing /> : state === "blocked" ? <BellOff /> : state === "install-first" ? <Smartphone /> : <Bell />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium">{title}</span>
        <span className="block text-[13px] text-muted-foreground">{body}</span>
      </span>
      {state === "off" && <button type="button" disabled={busy} onClick={turnOn} className="shrink-0 cursor-pointer rounded-full bg-[#141716] px-3.5 py-2 text-[13.5px] font-medium text-white disabled:opacity-50">{busy ? "Turning on…" : "Turn on"}</button>}
      {state === "on" && <button type="button" disabled={busy} onClick={turnOff} className="shrink-0 cursor-pointer rounded-full bg-[#141716]/[0.06] px-3.5 py-2 text-[13.5px] font-medium disabled:opacity-50">Turn off</button>}
    </div>
  );
}
