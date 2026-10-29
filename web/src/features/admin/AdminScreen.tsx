import * as React from "react";
import { AnimatePresence, m } from "motion/react";
import { Check, FolderPlus, MoreHorizontal, ReceiptText, ShieldCheck, Trash2, UserCheck, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AnimatedMoney, DateBadge, EASE, EmptyState, LoadingButton, NativeSelect, Page, PersonAvatar, SectionTitle, Segmented, fieldClass, listItem } from "@/components/app/bits";
import { AquaCard } from "@/features/groups/GroupsScreen";
import { useAdminAction, useAdminDashboard, useAdminExpenses, useAdminGroups, useAdminRequests, useMergePreview } from "@/hooks/queries";
import { post, type AccessRequest } from "@/lib/api";
import { inr } from "@/lib/money";
import { cn } from "@/lib/utils";

type Tab = "requests" | "groups" | "expenses";
type Confirm = { title: string; body: React.ReactNode; action: string; destructive?: boolean; run: () => Promise<unknown> };

export function AdminScreen({ adminName }: { adminName: string }) {
  const [tab, setTab] = React.useState<Tab>("requests");
  const dash = useAdminDashboard(), requests = useAdminRequests();
  const pending = requests.data?.filter(r => r.status === "pending").length ?? 0;
  const duplicates = (requests.data || []).filter(r => r.groupId && r.name.trim().toLowerCase() === adminName.trim().toLowerCase());
  const [merging, setMerging] = React.useState<AccessRequest | null>(null);
  const s = dash.data?.stats;

  return (
    <Page>
      <p className="inline-flex items-center gap-1.5 px-1 text-[15px] text-muted-foreground"><ShieldCheck className="size-4" />Administrator</p>
      <h1 className="page-title px-1">Overview</h1>
      <AquaCard className="mt-5">
        <p className="text-[14px] text-white/85">Total recorded spend</p>
        <div className="mt-2 min-h-11">{s ? <AnimatedMoney cents={s.totalSpentCents} size="hero" /> : <Skeleton className="h-11 w-48 bg-white/25" />}</div>
        <div className="mt-5 grid grid-cols-4 gap-2">
          {[["Groups", s?.groups], ["Members", s?.members], ["Pending", s?.pending], ["Expenses", s?.expenses]].map(([label, value]) => (
            <div key={label as string} className="rounded-[16px] bg-white/16 px-1 py-2.5 text-center backdrop-blur-sm">
              <p className="tabular text-[20px] leading-none font-semibold">{value ?? "–"}</p>
              <p className="mt-1 text-[11.5px] text-white/80">{label}</p>
            </div>
          ))}
        </div>
      </AquaCard>

      <AnimatePresence>
        {duplicates.map(d => (
          <m.div key={d.id} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="panel mt-4 flex items-start gap-3 p-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-[13px] bg-primary/10 text-primary"><UserCheck className="size-5" /></span>
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-medium">You also have a separate member entry in {d.groupName}</p>
                <p className="mt-0.5 text-muted-foreground">“{d.name}” is treated as a different person. Merge it so you're one person with an admin view and a normal view.</p>
                <Button size="sm" className="mt-3 h-8 rounded-full px-3.5" onClick={() => setMerging(d)}>Review merge</Button>
              </div>
            </div>
          </m.div>
        ))}
      </AnimatePresence>

      <div className="sticky top-[58px] z-20 -mx-4 mt-5 bg-[#f3f6f5]/70 px-4 py-2 backdrop-blur-2xl"><Segmented id="admin-tab" value={tab} onChange={setTab} options={[
        { value: "requests", label: <>Requests{pending > 0 && <span className="ml-1 inline-grid h-[18px] min-w-[18px] place-items-center rounded-full bg-negative px-1 text-[11px] font-semibold text-white">{pending}</span>}</> },
        { value: "groups", label: "Groups" },
        { value: "expenses", label: "Expenses" },
      ]} /></div>

      <AnimatePresence mode="wait" initial={false}>
        <m.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2, ease: EASE }} className="mt-5">
          {tab === "requests" && <RequestsTab onMerge={setMerging} />}
          {tab === "groups" && <GroupsTab />}
          {tab === "expenses" && <ExpensesTab />}
        </m.div>
      </AnimatePresence>
      <MergeDialog request={merging} onClose={() => setMerging(null)} />
    </Page>
  );
}

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-[#fff4db] text-[#b77900]",
  approved: "bg-positive-soft text-positive",
  revoked: "bg-[#0e1a16]/[0.05] text-muted-foreground",
  rejected: "bg-negative-soft text-negative",
};

function RequestsTab({ onMerge }: { onMerge: (r: AccessRequest) => void }) {
  const requests = useAdminRequests();
  const [confirm, setConfirm] = React.useState<Confirm | null>(null);
  const act = useAdminAction(({ id, action }: { id: string; action: string; label: string }) => post(`/api/admin/requests/${id}/${action}`), v => v.label);
  const busy = (id: string, action: string) => act.isPending && act.variables?.id === id && act.variables.action === action;
  const groups = React.useMemo(() => {
    const m = new Map<string, AccessRequest[]>();
    for (const r of requests.data || []) { const k = r.status === "pending" ? "Waiting for you" : "Members"; m.set(k, [...(m.get(k) || []), r]); }
    return [...m];
  }, [requests.data]);

  if (requests.isPending) return <div className="space-y-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-20 w-full rounded-2xl" />)}</div>;
  if (!requests.data?.length) return <EmptyState icon={<Users className="size-5" />} title="No requests yet">Share the app link so people can request access to a group.</EmptyState>;
  return (
    <div className="space-y-6">
      {groups.map(([title, list]) => (
        <section key={title}>
          <SectionTitle>{title}</SectionTitle>
          <div className="panel overflow-hidden [&>*:not(:last-child)]:border-b [&>*:not(:last-child)]:border-hairline">
            <AnimatePresence initial={false}>
              {list.map((r, i) => (
                <m.div key={r.id} layout custom={i} variants={listItem} initial="initial" animate="animate" exit="exit" className="flex items-center gap-3 px-4 py-3.5">
                  <PersonAvatar id={r.id} name={r.name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-medium">{r.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{r.groupName || "No group"} · {new Date(r.requestedAt).toLocaleDateString("en-IN", { dateStyle: "medium" })}</p>
                  </div>
                  <Badge variant="outline" className={cn("rounded-full border-0 px-2.5 py-0.5 text-[12px] font-medium capitalize", STATUS_STYLE[r.status])}>{r.status}</Badge>
                  {r.status === "pending" ? (
                    <div className="flex gap-1.5">
                      <LoadingButton size="icon-sm" variant="secondary" className="rounded-full" aria-label={"Reject " + r.name} loading={busy(r.id, "reject")} onClick={() => act.mutate({ id: r.id, action: "reject", label: r.name + " rejected." })}><X /></LoadingButton>
                      <LoadingButton size="sm" className="rounded-full" aria-label={"Approve " + r.name} loading={busy(r.id, "approve")} onClick={() => act.mutate({ id: r.id, action: "approve", label: r.name + " approved." })}><Check />Approve</LoadingButton>
                    </div>
                  ) : (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button size="icon-sm" variant="ghost" aria-label={"Actions for " + r.name}><MoreHorizontal /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        {r.status === "approved" && <DropdownMenuItem onSelect={() => act.mutate({ id: r.id, action: "revoke", label: r.name + "'s access revoked." })}>Revoke access</DropdownMenuItem>}
                        {(r.status === "rejected" || r.status === "revoked") && <DropdownMenuItem onSelect={() => act.mutate({ id: r.id, action: "approve", label: r.name + " approved." })}>Approve again</DropdownMenuItem>}
                        {r.groupId && <DropdownMenuItem onSelect={() => onMerge(r)}><UserCheck />This is me — merge</DropdownMenuItem>}
                        <DropdownMenuSeparator />
                        {(r.status === "approved" || r.status === "revoked") && (
                          <DropdownMenuItem variant="destructive" onSelect={() => setConfirm({ title: `Remove ${r.name} from ${r.groupName}?`, body: "Their access is revoked. Their expenses and payments stay in the history.", action: "Remove", destructive: true, run: () => act.mutateAsync({ id: r.id, action: "remove", label: r.name + " removed." }) })}>Remove from group</DropdownMenuItem>
                        )}
                        {r.status === "revoked" && (
                          <DropdownMenuItem variant="destructive" onSelect={() => setConfirm({ title: `Delete ${r.name}'s access record?`, body: "Their name stays on past expenses and payments.", action: "Delete", destructive: true, run: () => act.mutateAsync({ id: r.id, action: "delete", label: r.name + " deleted." }) })}><Trash2 />Delete record</DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </m.div>
              ))}
            </AnimatePresence>
          </div>
        </section>
      ))}
      <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

function GroupsTab() {
  const groups = useAdminGroups();
  const [name, setName] = React.useState("");
  const [confirm, setConfirm] = React.useState<Confirm | null>(null);
  const create = useAdminAction((n: string) => post("/api/admin/groups", { name: n }), n => `Group “${n}” created.`);
  const remove = useAdminAction((g: { id: string; name: string }) => post(`/api/admin/groups/${g.id}/delete`), g => `Group “${g.name}” deleted.`);
  return (
    <div className="space-y-6">
      <form className="flex gap-2" onSubmit={e => { e.preventDefault(); create.mutate(name.trim(), { onSuccess: () => setName("") }); }}>
        <Input aria-label="New group name" required minLength={2} maxLength={80} placeholder="New group, e.g. Goa Trip 2026" value={name} onChange={e => setName(e.target.value)} className={cn(fieldClass, "h-11")} />
        <LoadingButton type="submit" className="h-12 px-5" loading={create.isPending} loadingText="Creating…"><FolderPlus />Create</LoadingButton>
      </form>
      <section>
        <SectionTitle>All groups</SectionTitle>
        <div className="panel overflow-hidden [&>*:not(:last-child)]:border-b [&>*:not(:last-child)]:border-hairline">
          {groups.isPending ? <div className="p-4"><Skeleton className="h-10 w-full" /></div> : !groups.data?.length ? <EmptyState icon={<FolderPlus className="size-5" />} title="No groups yet">Create the first one above.</EmptyState> : (
            <AnimatePresence initial={false}>
              {groups.data.map((g, i) => (
                <m.div key={g.id} layout custom={i} variants={listItem} initial="initial" animate="animate" exit="exit" className="flex items-center gap-3 px-4 py-3.5">
                  <PersonAvatar id={g.id} name={g.name} />
                  <div className="min-w-0 flex-1"><p className="truncate font-medium">{g.name}</p><p className="text-xs text-muted-foreground">{g.memberCount} {g.memberCount === 1 ? "member" : "members"}</p></div>
                  <Button size="icon-sm" variant="ghost" aria-label={"Delete " + g.name} className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setConfirm({ title: `Delete “${g.name}”?`, body: "This permanently removes its expenses, payments, members and access requests. This cannot be undone.", action: "Delete group", destructive: true, run: () => remove.mutateAsync(g) })}>
                    <Trash2 />
                  </Button>
                </m.div>
              ))}
            </AnimatePresence>
          )}
        </div>
      </section>
      <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}

function ExpensesTab() {
  const expenses = useAdminExpenses();
  const [groupId, setGroupId] = React.useState("");
  const groupNames = React.useMemo(() => [...new Map((expenses.data || []).map(x => [x.groupId, x.groupName]))], [expenses.data]);
  const rows = (expenses.data || []).filter(x => !groupId || x.groupId === groupId);
  return (
    <div className="panel overflow-hidden [&>*:not(:last-child)]:border-b [&>*:not(:last-child)]:border-hairline">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 pb-2">
        <NativeSelect aria-label="Filter by group" value={groupId} onChange={e => setGroupId(e.target.value)} className="h-10 min-w-0 flex-1 text-[15px]">
          <option value="">All groups</option>
          {groupNames.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
        </NativeSelect>
        <span className="footnote tabular text-muted-foreground" data-testid="admin-expense-summary">{rows.length} {rows.length === 1 ? "expense" : "expenses"} · {inr(rows.reduce((s, x) => s + x.amountCents, 0))}</span>
      </div>
      {expenses.isPending ? <div className="space-y-2 p-4">{[0, 1, 2].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div> : !rows.length ? <EmptyState icon={<ReceiptText className="size-5" />} title="No expenses yet" /> : (
        <Table>
          <TableHeader><TableRow className="hover:bg-transparent"><TableHead className="w-12 pl-4">Date</TableHead><TableHead>Expense</TableHead><TableHead>Paid by</TableHead><TableHead className="pr-4 text-right">Amount</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map(x => (
              <TableRow key={x.id}>
                <TableCell className="pl-4"><DateBadge ts={x.createdAt} /></TableCell>
                <TableCell className="max-w-0 w-full"><span className="block truncate font-medium">{x.description}</span><span className="block truncate text-xs text-muted-foreground">{x.groupName}</span></TableCell>
                <TableCell className="max-w-24 truncate text-sm">{x.paidBy}</TableCell>
                <TableCell className="tabular pr-4 text-right">{inr(x.amountCents)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function ConfirmDialog({ confirm, onClose }: { confirm: Confirm | null; onClose: () => void }) {
  const [busy, setBusy] = React.useState(false);
  return (
    <AlertDialog open={!!confirm} onOpenChange={o => { if (!o && !busy) onClose(); }}>
      <AlertDialogContent className="max-w-[360px] rounded-[26px] border-0 p-6">
        <AlertDialogHeader><AlertDialogTitle className="title-2">{confirm?.title}</AlertDialogTitle><AlertDialogDescription>{confirm?.body}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy} className="rounded-full border-0 bg-[#0e1a16]/[0.06] shadow-none">Cancel</AlertDialogCancel>
          <LoadingButton variant={confirm?.destructive ? "destructive" : "default"} loading={busy} onClick={async () => {
            if (!confirm) return;
            setBusy(true);
            try { await confirm.run(); onClose(); } catch { /* toast shown by the mutation */ } finally { setBusy(false); }
          }}>{confirm?.action}</LoadingButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function MergeDialog({ request, onClose }: { request: AccessRequest | null; onClose: () => void }) {
  const preview = useMergePreview(request?.id ?? null);
  const merge = useAdminAction((id: string) => post(`/api/admin/requests/${id}/merge-into-admin`), () => "Merged. You're now one person in this group.");
  const p = preview.data;
  return (
    <AlertDialog open={!!request} onOpenChange={o => { if (!o && !merge.isPending) onClose(); }}>
      <AlertDialogContent className="max-w-[360px] rounded-[26px] border-0 p-6">
        <AlertDialogHeader>
          <AlertDialogTitle className="title-2">Merge “{request?.name}” into you?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>Everything this member entry did in <b className="text-foreground">{request?.groupName}</b> becomes yours. You'll be one person with two views: <b className="text-foreground">My groups</b> and <b className="text-foreground">Admin</b>.</p>
              {!p ? <Skeleton className="h-24 w-full" /> : (
                <ul className="space-y-2 rounded-xl bg-muted/60 p-3.5 text-foreground ring-1 ring-hairline ring-inset">
                  <li className="flex justify-between"><span>Expenses they paid</span><b className="tabular">{p.expensesPaid}</b></li>
                  <li className="flex justify-between"><span>Expense shares</span><b className="tabular">{p.shares}</b></li>
                  <li className="flex justify-between"><span>Payments</span><b className="tabular">{p.payments}</b></li>
                  {p.paymentsWithAdmin > 0 && <li className="flex justify-between text-muted-foreground"><span>Payments to yourself (removed)</span><b className="tabular">{p.paymentsWithAdmin}</b></li>}
                  <li className="flex justify-between border-t pt-1.5"><span>Your balance after merge</span><b className="tabular">{inr(p.adminBalanceCents + p.memberBalanceCents)}</b></li>
                </ul>
              )}
              <p>Shares on the same expense are added together. Everyone else's balance stays exactly the same.</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={merge.isPending} className="rounded-full border-0 bg-[#0e1a16]/[0.06] shadow-none">Cancel</AlertDialogCancel>
          <LoadingButton loading={merge.isPending} loadingText="Merging…" disabled={!p} onClick={() => request && merge.mutate(request.id, { onSuccess: onClose })}>Merge into me</LoadingButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
