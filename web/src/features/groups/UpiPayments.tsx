import * as React from "react";
import { Copy, Download, ExternalLink, ImagePlus, QrCode, Share2, Trash2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { List, LoadingButton, PersonAvatar, SectionTitle, Footnote, fieldClass, pressableRow } from "@/components/app/bits";
import { SheetHeader } from "./AddExpenseDrawer";
import { useGroupPaymentMethods, useMyPaymentMethod, useSavePaymentMethod } from "@/hooks/queries";
import type { GroupPaymentMethod } from "@/lib/api";
import { shrinkQrImage, upiPayLink } from "@/lib/image";

const UPI_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,255}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$/;
export const qrSrc = (groupId: string, p: { memberId: string; updatedAt: number | null }) => `/api/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(p.memberId)}/qr?v=${p.updatedAt || 0}`;

export async function copyText(text: string, label = "Copied") {
  try { await navigator.clipboard.writeText(text); toast.success(label); }
  catch { toast.message(text, { description: "Copy this UPI ID." }); }
}

// Add or change how people pay me: UPI ID and an uploaded QR code.
export function PaymentMethodSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const mine = useMyPaymentMethod();
  const save = useSavePaymentMethod();
  const [upiId, setUpiId] = React.useState("");
  // undefined: keep the saved QR; null: remove it; string: a newly picked image.
  const [qr, setQr] = React.useState<string | null | undefined>(undefined);
  const [busyImage, setBusyImage] = React.useState(false);
  const [error, setError] = React.useState("");
  const file = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => { if (open) { setUpiId(mine.data?.upiId || ""); setQr(undefined); setError(""); } }, [open, mine.data?.upiId]);

  const m = mine.data;
  const preview = typeof qr === "string" ? qr : qr === undefined && m?.hasQr ? `/api/payment-method/qr?v=${m.updatedAt || 0}` : null;
  const valid = UPI_RE.test(upiId.trim());
  const changed = upiId.trim() !== (m?.upiId || "") || qr !== undefined;

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setBusyImage(true); setError("");
    try { setQr(await shrinkQrImage(f)); } catch (e) { setError((e as Error).message); }
    finally { setBusyImage(false); if (file.current) file.current.value = ""; }
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return setError("Enter a valid UPI ID, like name@okbank.");
    save.mutate({ upiId: upiId.trim(), ...(qr !== undefined ? { qr } : {}) }, {
      onSuccess: () => { toast.success("UPI details saved. People can now pay you by UPI."); onOpenChange(false); },
      onError: err => setError(err.message),
    });
  };

  return (
    <Drawer open={open} onOpenChange={o => { if (!save.isPending) onOpenChange(o); }}>
      <DrawerContent className="mx-auto max-h-[92dvh] max-w-xl rounded-t-[28px] border-0">
        <SheetHeader title="Your UPI" description="How people in your groups pay you. Only they can see it." disabled={save.isPending} />
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pt-1 pb-5">
            <div>
              <label htmlFor="upi-id" className="eyebrow mb-2 block px-1">UPI ID</label>
              <Input id="upi-id" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="name@okbank" value={upiId} onChange={e => { setUpiId(e.target.value); setError(""); }} className={fieldClass} />
            </div>
            <div>
              <p className="eyebrow mb-2 px-1">UPI QR code</p>
              <div className="panel flex items-center gap-4 p-4">
                <div className="grid size-28 shrink-0 place-items-center overflow-hidden rounded-[14px] bg-[#141716]/[0.04]">
                  {preview ? <img src={preview} alt="Your UPI QR code" className="size-full object-contain" /> : <QrCode className="size-8 text-muted-foreground" />}
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="text-[13px] text-muted-foreground">Upload a screenshot of the QR from your UPI app (GPay, PhonePe, Paytm…).</p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={busyImage} onClick={() => file.current?.click()} className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-[#141716] px-3.5 py-2 text-[13.5px] font-medium text-white transition-transform active:scale-95 disabled:opacity-50">
                      <ImagePlus className="size-4" />{busyImage ? "Preparing…" : preview ? "Change" : "Upload QR"}
                    </button>
                    {preview && <button type="button" onClick={() => setQr(null)} className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-[#141716]/[0.06] px-3.5 py-2 text-[13.5px] font-medium transition-transform active:scale-95"><Trash2 className="size-4" />Remove</button>}
                  </div>
                  <input ref={file} type="file" accept="image/*" className="hidden" aria-label="Choose QR image" onChange={e => pick(e.target.files?.[0])} />
                </div>
              </div>
            </div>
            {error && <p role="alert" className="subhead rounded-[16px] bg-negative-soft px-4 py-3 text-negative">{error}</p>}
            {m?.upiId && (
              <button type="button" disabled={save.isPending} onClick={() => save.mutate("delete", { onSuccess: () => { toast.success("UPI details removed."); onOpenChange(false); } })}
                className="mx-auto block cursor-pointer text-[13.5px] font-medium text-negative">Remove my UPI details</button>
            )}
          </div>
          <div className="safe-bottom bg-[#fbfbf9]/90 px-4 pt-3 backdrop-blur-xl">
            <LoadingButton type="submit" size="xl" className="w-full" disabled={!valid || !changed || busyImage} loading={save.isPending} loadingText="Saving…">Save UPI details</LoadingButton>
          </div>
        </form>
      </DrawerContent>
    </Drawer>
  );
}

// Fetches a person's QR as a file, for downloading or sharing.
async function qrFile(src: string, name: string) {
  const res = await fetch(src, { credentials: "same-origin" });
  if (!res.ok) throw new Error("Could not load the QR code.");
  const blob = await res.blob();
  const ext = blob.type === "image/jpeg" ? "jpg" : blob.type === "image/webp" ? "webp" : "png";
  return new File([blob], `${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-upi-qr.${ext}`, { type: blob.type });
}

// A person's QR, big enough to scan from another phone, with their UPI ID,
// plus: copy the ID, download or share the QR (e.g. into GPay/PhonePe/Paytm
// to scan it from the image), or open a UPI app straight on the pay page.
export function QrDialog({ groupId, person, onClose, onEdit }: { groupId: string; person: GroupPaymentMethod | null; onClose: () => void; onEdit?: () => void }) {
  const [busy, setBusy] = React.useState<"" | "download" | "share">("");
  const src = person ? qrSrc(groupId, person) : "";
  const download = async () => {
    if (!person) return;
    setBusy("download");
    try {
      const f = await qrFile(src, person.name);
      const url = URL.createObjectURL(f);
      const a = Object.assign(document.createElement("a"), { href: url, download: f.name });
      document.body.appendChild(a); a.click(); a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast.success("QR code saved.");
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(""); }
  };
  const share = async () => {
    if (!person) return;
    setBusy("share");
    const text = `Pay ${person.name} by UPI: ${person.upiId}`;
    try {
      const f = person.hasQr ? await qrFile(src, person.name) : null;
      if (f && navigator.canShare?.({ files: [f] })) await navigator.share({ files: [f], title: `${person.name}'s UPI QR`, text });
      else if (navigator.share) await navigator.share({ title: `${person.name}'s UPI`, text });
      else await copyText(person.upiId || "", "UPI ID copied (sharing isn't available here)");
    } catch (e) { if ((e as Error).name !== "AbortError") toast.error("Couldn't share. Try Download instead."); }
    finally { setBusy(""); }
  };
  const mine = !!person?.isMe;
  return (
    <AlertDialog open={!!person} onOpenChange={o => { if (!o) onClose(); }}>
      <AlertDialogContent className="max-w-[360px] rounded-[26px] border-0 p-6">
        {person && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle className="title-2">{mine ? "Your UPI" : `Pay ${person.name}`}</AlertDialogTitle>
              <AlertDialogDescription>{!person.upiId ? "No UPI details yet." : mine ? "Share this so people can pay you." : "Scan with any UPI app, or copy the UPI ID."}</AlertDialogDescription>
            </AlertDialogHeader>
            {person.hasQr && <img src={src} alt={`${person.name}'s UPI QR code`} className="mx-auto aspect-square w-full max-w-[260px] rounded-[16px] bg-white object-contain p-2 ring-1 ring-[#141716]/[0.06]" />}
            {person.upiId ? (
              <>
                <button type="button" aria-label={`Copy UPI ID ${person.upiId}`} onClick={() => copyText(person.upiId!, "UPI ID copied")} className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-[14px] bg-[#141716]/[0.04] px-4 py-3 text-left transition-transform active:scale-[0.98]">
                  <span className="min-w-0">
                    <span className="block text-[11.5px] text-muted-foreground">UPI ID · tap to copy</span>
                    <span className="block truncate text-[15px] font-medium">{person.upiId}</span>
                  </span>
                  <Copy className="size-4 shrink-0 text-muted-foreground" />
                </button>
                <div className="grid grid-cols-2 gap-2">
                  {person.hasQr && (
                    <button type="button" disabled={!!busy} onClick={download} className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-full bg-[#141716]/[0.06] py-2.5 text-[14px] font-medium transition-transform active:scale-95 disabled:opacity-50">
                      <Download className="size-4" />{busy === "download" ? "Saving…" : "Download"}
                    </button>
                  )}
                  <button type="button" disabled={!!busy} onClick={share} className={`inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-full bg-[#141716]/[0.06] py-2.5 text-[14px] font-medium transition-transform active:scale-95 disabled:opacity-50${person.hasQr ? "" : " col-span-2"}`}>
                    <Share2 className="size-4" />{busy === "share" ? "Opening…" : person.hasQr ? "Share QR" : "Share UPI ID"}
                  </button>
                </div>
                {!mine && (
                  <a href={upiPayLink({ upiId: person.upiId, name: person.name, note: "Split It" })} className="inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-[#141716] py-3 text-[14.5px] font-medium text-white transition-transform active:scale-[0.98]">
                    <ExternalLink className="size-4" />Pay in GPay, PhonePe, Paytm…
                  </a>
                )}
              </>
            ) : (
              <p className="rounded-[14px] bg-[#141716]/[0.04] px-4 py-3 text-center text-[14px] text-muted-foreground">{person.name} hasn't added UPI details yet. Pay them your usual way, then record it with Settle up.</p>
            )}
            <div className="grid grid-cols-2 gap-2">
              {mine && onEdit && <button type="button" onClick={onEdit} className="h-11 cursor-pointer rounded-full bg-[#141716]/[0.06] text-[15px] font-medium">Edit</button>}
              <AlertDialogCancel variant={mine ? "outline" : "default"} className={`h-11 rounded-full text-[15px]${mine && onEdit ? "" : " col-span-2"}`}>Done</AlertDialogCancel>
            </div>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}

// Payments tab: everyone in the group and how to pay them.
export function UpiPeople({ groupId }: { groupId: string }) {
  const people = useGroupPaymentMethods(groupId);
  const [editing, setEditing] = React.useState(false);
  const [showing, setShowing] = React.useState<GroupPaymentMethod | null>(null);
  const list = [...(people.data || [])].sort((a, b) => Number(b.isMe) - Number(a.isMe) || Number(!!b.upiId) - Number(!!a.upiId) || a.name.localeCompare(b.name));
  return (
    <section>
      <SectionTitle>Pay by UPI</SectionTitle>
      <List inset={68}>
        {list.map(p => {
          const has = !!p.upiId;
          // The whole row is one tap target: it opens that person's QR and UPI
          // ID (yours too, to share it); with no UPI yet, yours opens settings.
          return (
            <button key={p.memberId} type="button" onClick={() => (p.isMe && !has ? setEditing(true) : setShowing(p))}
              aria-label={p.isMe ? (has ? "Your UPI QR" : "Add your UPI") : `Pay ${p.name} by UPI`} className={pressableRow}>
              <PersonAvatar id={p.memberId} name={p.name} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15.5px] font-medium">{p.name}{p.isMe && <span className="font-normal text-muted-foreground"> (you)</span>}</span>
                <span className="block truncate text-[13px] text-muted-foreground">{has ? p.upiId : p.isMe ? "Add yours so people can pay you" : "No UPI added yet"}</span>
              </span>
              {p.isMe ? (
                <span className="shrink-0 rounded-full bg-[#141716]/[0.05] px-3 py-1.5 text-[13px] font-medium">{has ? "Edit" : "Add UPI"}</span>
              ) : has ? (
                <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-[10px] bg-white ring-1 ring-[#141716]/[0.08]">
                  {p.hasQr ? <img src={qrSrc(groupId, p)} alt="" className="size-full object-contain p-0.5" /> : <Wallet className="size-5 text-muted-foreground" />}
                </span>
              ) : null}
            </button>
          );
        })}
      </List>
      <Footnote>Tap anyone for their QR: copy the UPI ID, download or share the QR, or pay in your UPI app. After paying, record it with Settle up.</Footnote>
      <PaymentMethodSheet open={editing} onOpenChange={setEditing} />
      <QrDialog groupId={groupId} person={showing} onClose={() => setShowing(null)} onEdit={() => { setShowing(null); setEditing(true); }} />
    </section>
  );
}

// Inside Settle up: pay the person straight from here.
export function PayByUpi({ groupId, toMemberId, amount }: { groupId: string; toMemberId: string; amount: string }) {
  const people = useGroupPaymentMethods(groupId);
  const p = people.data?.find(x => x.memberId === toMemberId);
  if (!p?.upiId) return p ? <p className="footnote mt-4 rounded-[16px] bg-[#141716]/[0.035] px-4 py-3 text-center text-muted-foreground">{p.name} hasn't added UPI details yet. Pay them your usual way, then record it here.</p> : null;
  const link = upiPayLink({ upiId: p.upiId, name: p.name, amount: /^\d+(\.\d{1,2})?$/.test(amount.trim()) ? amount.trim() : undefined, note: "Split It" });
  return (
    <div className="panel mt-5 p-4" data-testid="pay-by-upi">
      <p className="eyebrow">Pay {p.name} by UPI</p>
      <div className="mt-3 flex items-center gap-4">
        {p.hasQr && <img src={qrSrc(groupId, p)} alt={`${p.name}'s UPI QR code`} className="size-28 shrink-0 rounded-[12px] bg-white object-contain p-1 ring-1 ring-[#141716]/[0.06]" />}
        <div className="min-w-0 flex-1 space-y-2">
          <button type="button" onClick={() => copyText(p.upiId!, "UPI ID copied")} className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-[12px] bg-[#141716]/[0.04] px-3 py-2 text-left">
            <span className="truncate text-[14px] font-medium">{p.upiId}</span><Copy className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
          <a href={link} className="inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-[#141716] px-3 py-2.5 text-[14px] font-medium text-white transition-transform active:scale-[0.98]">
            <ExternalLink className="size-4" />Pay{/^\d/.test(amount.trim()) ? ` ₹${amount.trim()}` : ""} in a UPI app
          </a>
        </div>
      </div>
      <p className="footnote mt-3 text-muted-foreground">Then come back and tap Record payment so {p.name} can confirm it.</p>
    </div>
  );
}
