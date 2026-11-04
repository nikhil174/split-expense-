import * as React from "react";
import { Camera, X } from "lucide-react";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { shrinkPhoto } from "@/lib/image";
import { cn } from "@/lib/utils";

// Photos on an expense: a receipt, a bill, proof of what was bought. At most
// this many (the server checks too).
export const MAX_EXPENSE_PHOTOS = 3;

export const expensePhotoSrc = (groupId: string, expenseId: string, photoId: string) =>
  `/api/groups/${encodeURIComponent(groupId)}/expenses/${encodeURIComponent(expenseId)}/photos/${encodeURIComponent(photoId)}`;

const tile = "relative size-[72px] shrink-0 overflow-hidden rounded-[14px] bg-white ring-1 ring-[#141716]/[0.08]";

// The form part (add or edit an expense): photos it already has (kept, by id)
// and new ones (data URLs, shrunk on the phone), each with a remove button,
// and an "Add photo" tile while there is room.
export function ExpensePhotosField({ groupId, expenseId, kept, onKeptChange, added, onAddedChange, disabled, onError }: {
  groupId: string; expenseId?: string; kept: string[]; onKeptChange: (ids: string[]) => void;
  added: string[]; onAddedChange: (urls: string[]) => void; disabled?: boolean; onError: (message: string) => void;
}) {
  const input = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const room = MAX_EXPENSE_PHOTOS - kept.length - added.length;
  const pick = async (files: FileList | null) => {
    const list = [...(files || [])];
    if (!list.length) return;
    if (list.length > room) onError(`You can attach ${MAX_EXPENSE_PHOTOS} photos at most, so only the first ${room} ${room === 1 ? "was" : "were"} added.`);
    setBusy(true);
    try {
      const urls: string[] = [];
      for (const f of list.slice(0, room)) urls.push(await shrinkPhoto(f));
      onAddedChange([...added, ...urls]);
    } catch (e) { onError((e as Error).message); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  };
  const remove = (label: string, onClick: () => void) => (
    <button type="button" aria-label={label} disabled={disabled} onClick={onClick}
      className="absolute top-1 right-1 grid size-6 cursor-pointer place-items-center rounded-full bg-black/60 text-white transition-transform active:scale-90 disabled:opacity-50"><X className="size-3.5" strokeWidth={2.6} /></button>
  );
  return (
    <div data-testid="expense-photos">
      <div className="flex flex-wrap gap-2.5">
        {kept.map((id, i) => expenseId && (
          <div key={id} className={tile}>
            <img src={expensePhotoSrc(groupId, expenseId, id)} alt={`Photo ${i + 1}`} className="size-full object-cover" />
            {remove(`Remove photo ${i + 1}`, () => onKeptChange(kept.filter(k => k !== id)))}
          </div>
        ))}
        {added.map((url, i) => (
          <div key={url.slice(-32) + i} className={tile}>
            <img src={url} alt={`New photo ${i + 1}`} className="size-full object-cover" />
            {remove(`Remove new photo ${i + 1}`, () => onAddedChange(added.filter((_, j) => j !== i)))}
          </div>
        ))}
        {room > 0 && (
          <button type="button" disabled={disabled || busy} onClick={() => input.current?.click()}
            className={cn(tile, "flex cursor-pointer flex-col items-center justify-center gap-1 border border-dashed border-[#141716]/20 bg-transparent text-[12px] font-medium text-tint ring-0 transition-transform active:scale-95 disabled:opacity-50")}>
            <Camera className="size-5" strokeWidth={2} />{busy ? "Preparing…" : "Add photo"}
          </button>
        )}
      </div>
      <p className="footnote mt-2 px-1 text-muted-foreground">Optional: a receipt, bill or proof, so everyone can see it. Up to {MAX_EXPENSE_PHOTOS}.</p>
      <input ref={input} type="file" accept="image/*" multiple className="hidden" aria-label="Choose photos" onChange={e => pick(e.target.files)} />
    </div>
  );
}

// On an opened expense: its photos as thumbnails; tap one to see it full size.
export function ExpensePhotoStrip({ groupId, expenseId, photoIds, title }: { groupId: string; expenseId: string; photoIds: string[]; title: string }) {
  const [shown, setShown] = React.useState<number | null>(null);
  if (!photoIds.length) return null;
  return (
    <div>
      <div className="flex flex-wrap gap-2.5" data-testid="expense-photo-strip">
        {photoIds.map((id, i) => (
          <button key={id} type="button" aria-label={`View photo ${i + 1} of ${title}`} onClick={e => { e.stopPropagation(); setShown(i); }} className={cn(tile, "cursor-pointer transition-transform active:scale-95")}>
            <img src={expensePhotoSrc(groupId, expenseId, id)} alt="" loading="lazy" className="size-full object-cover" />
          </button>
        ))}
      </div>
      <AlertDialog open={shown !== null} onOpenChange={o => { if (!o) setShown(null); }}>
        <AlertDialogContent className="max-w-[420px] rounded-[26px] border-0 p-5" onClick={e => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle className="title-2">{title}</AlertDialogTitle>
            <AlertDialogDescription>{photoIds.length > 1 && shown !== null ? `Photo ${shown + 1} of ${photoIds.length}` : "Photo attached to this expense"}</AlertDialogDescription>
          </AlertDialogHeader>
          {shown !== null && <img src={expensePhotoSrc(groupId, expenseId, photoIds[shown])} alt={`Photo ${shown + 1} of ${title}`} className="max-h-[65dvh] w-full rounded-[14px] bg-white object-contain ring-1 ring-[#141716]/[0.06]" />}
          <div className={cn("grid gap-2", photoIds.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
            {photoIds.length > 1 && <button type="button" onClick={() => setShown(i => ((i ?? 0) + 1) % photoIds.length)} className="h-11 cursor-pointer rounded-full bg-[#141716]/[0.06] text-[15px] font-medium">Next photo</button>}
            <AlertDialogCancel variant="default" className="h-11 w-full rounded-full text-[15px]">Close</AlertDialogCancel>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
