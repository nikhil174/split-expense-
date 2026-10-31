import * as React from "react";
import { toast } from "sonner";
import { Copy, Download, ImageUp, Link2Off, RefreshCw, Share2 } from "lucide-react";
import { LoadingButton } from "@/components/app/bits";
import { useAccountAction, useInviteLink } from "@/hooks/queries";
import { post } from "@/lib/api";
import { joinCodeFrom, joinUrl } from "@/lib/route";
import { cn } from "@/lib/utils";

// A QR code image for some text (drawn in the browser; the qrcode library
// loads only when a QR is shown).
export function QrCode({ text, size = 220, className, label }: { text: string; size?: number; className?: string; label: string }) {
  const [src, setSrc] = React.useState("");
  React.useEffect(() => {
    let live = true;
    import("qrcode").then(q => q.toDataURL(text, { width: size * 2, margin: 1, errorCorrectionLevel: "M", color: { dark: "#141716", light: "#ffffff" } })).then(url => { if (live) setSrc(url); });
    return () => { live = false; };
  }, [text, size]);
  return src ? <img src={src} alt={label} width={size} height={size} className={cn("rounded-[14px] bg-white", className)} />
    : <div style={{ width: size, height: size }} className={cn("animate-pulse rounded-[14px] bg-[#141716]/[0.05]", className)} />;
}

// The group's invite link and QR: anyone in the group can show, copy or share
// it; admins can replace it (old links stop working) or turn it off. Joining
// still needs a group admin's approval and the group PIN.
export function InviteLinkCard({ groupId, groupName }: { groupId: string; groupName: string }) {
  const q = useInviteLink(groupId);
  const manage = useAccountAction((what: "reset" | "off") => post(`/api/groups/${groupId}/invite-link/${what}`), w => w === "reset" ? "New link made. The old one no longer works." : "Invite link turned off.");
  const code = q.data?.code, url = code ? joinUrl(code) : "";
  const copy = async () => { try { await navigator.clipboard.writeText(url); toast.success("Link copied."); } catch { toast.error("Couldn't copy. Long-press the link instead."); } };
  const share = async () => {
    const text = `Join “${groupName}” on Split It. You'll need the group PIN, and an admin approves you.`;
    if (navigator.share) { try { await navigator.share({ title: "Join " + groupName, text, url }); return; } catch { return; } }
    copy();
  };
  const download = async () => {
    const q2 = await import("qrcode");
    const a = document.createElement("a");
    a.href = await q2.toDataURL(url, { width: 800, margin: 2 });
    a.download = `split-it-${groupName.replace(/[^\w]+/g, "-").toLowerCase()}-qr.png`;
    a.click();
  };
  if (q.isPending) return <div className="panel h-40 animate-pulse" />;
  return (
    <section className="panel p-4" data-testid="invite-link">
      <p className="text-[15px] font-medium">Invite link and QR</p>
      {!code ? (
        <p className="mt-1 text-[13.5px] text-muted-foreground">{q.data?.canManage ? "The invite link is off." : "There's no invite link right now. Ask a group admin."}</p>
      ) : (
        <>
          <p className="mt-1 text-[13px] text-muted-foreground">Anyone with it can ask to join. They need the group PIN, and an admin lets them in.</p>
          <div className="mt-3 flex justify-center"><QrCode text={url} label={`QR code to join ${groupName}`} /></div>
          <button type="button" onClick={copy} className="mt-3 block w-full cursor-pointer truncate rounded-[12px] bg-[#141716]/[0.04] px-3 py-2 text-left font-mono text-[12px] text-muted-foreground" data-testid="invite-url">{url}</button>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <button type="button" onClick={share} className="flex cursor-pointer flex-col items-center gap-1 rounded-[14px] bg-[#141716] py-2.5 text-[12.5px] font-medium text-white transition-transform active:scale-95"><Share2 className="size-4" />Share</button>
            <button type="button" onClick={copy} className="flex cursor-pointer flex-col items-center gap-1 rounded-[14px] bg-[#141716]/[0.06] py-2.5 text-[12.5px] font-medium transition-transform active:scale-95"><Copy className="size-4" />Copy</button>
            <button type="button" onClick={download} className="flex cursor-pointer flex-col items-center gap-1 rounded-[14px] bg-[#141716]/[0.06] py-2.5 text-[12.5px] font-medium transition-transform active:scale-95"><Download className="size-4" />Save QR</button>
          </div>
        </>
      )}
      {q.data?.canManage && (
        <div className="mt-3 flex gap-2">
          <LoadingButton variant="secondary" size="sm" className="flex-1 rounded-full" loading={manage.isPending && manage.variables === "reset"} loadingText="Making…" onClick={() => manage.mutate("reset")}><RefreshCw className="size-3.5" />{code ? "New link" : "Turn on"}</LoadingButton>
          {code && <LoadingButton variant="secondary" size="sm" className="flex-1 rounded-full" loading={manage.isPending && manage.variables === "off"} loadingText="Turning off…" onClick={() => manage.mutate("off")}><Link2Off className="size-3.5" />Turn off</LoadingButton>}
        </div>
      )}
    </section>
  );
}

// Scans a Split It invite QR with the camera (BarcodeDetector where the
// browser has it, otherwise jsQR on video frames), or from a photo.
type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };
declare global { interface Window { BarcodeDetector?: new (o: { formats: string[] }) => Detector } }

async function decodeCanvas(canvas: HTMLCanvasElement): Promise<string | null> {
  if (window.BarcodeDetector) {
    try { const found = await new window.BarcodeDetector({ formats: ["qr_code"] }).detect(canvas); if (found[0]) return found[0].rawValue; } catch { /* fall back */ }
  }
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const jsQR = (await import("jsqr")).default;
  return jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" })?.data ?? null;
}

export function QrScanner({ onCode }: { onCode: (code: string) => void }) {
  const video = React.useRef<HTMLVideoElement>(null);
  const [state, setState] = React.useState<"starting" | "scanning" | "no-camera">("starting");
  const done = React.useRef(false);
  const found = React.useCallback((text: string | null) => {
    if (done.current || !text) return false;
    const code = joinCodeFrom(text);
    if (!code) { toast.error("That QR isn't a Split It invite."); return false; }
    done.current = true;
    onCode(code);
    return true;
  }, [onCode]);

  React.useEffect(() => {
    let stream: MediaStream | null = null, timer = 0, live = true;
    const canvas = document.createElement("canvas");
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (!live || !video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        setState("scanning");
        const tick = async () => {
          const v = video.current;
          if (!live || done.current || !v) return;
          if (v.videoWidth) {
            const scale = Math.min(1, 640 / v.videoWidth);
            canvas.width = Math.round(v.videoWidth * scale); canvas.height = Math.round(v.videoHeight * scale);
            canvas.getContext("2d")?.drawImage(v, 0, 0, canvas.width, canvas.height);
            const text = await decodeCanvas(canvas);
            if (text && found(text)) return;
          }
          timer = window.setTimeout(tick, 250);
        };
        tick();
      } catch { if (live) setState("no-camera"); }
    })();
    return () => { live = false; clearTimeout(timer); stream?.getTracks().forEach(t => t.stop()); };
  }, [found]);

  const fromPhoto = async (file: File | undefined) => {
    if (!file) return;
    const bitmap = await createImageBitmap(file).catch(() => null);
    if (!bitmap) { toast.error("Couldn't read that image."); return; }
    const canvas = document.createElement("canvas"), scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    if (!found(await decodeCanvas(canvas))) toast.error("No Split It QR found in that photo.");
  };

  return (
    <div className="space-y-3">
      <div className="relative mx-auto aspect-square w-full max-w-[300px] overflow-hidden rounded-[22px] bg-[#141716]">
        <video ref={video} muted playsInline className={cn("size-full object-cover", state !== "scanning" && "opacity-0")} />
        {state === "scanning" && <div aria-hidden className="pointer-events-none absolute inset-[18%] rounded-[18px] border-2 border-white/80 shadow-[0_0_0_9999px_rgb(0_0_0/35%)]" />}
        {state !== "scanning" && <p className="absolute inset-0 grid place-items-center px-6 text-center text-[13.5px] text-white/80">{state === "starting" ? "Starting the camera…" : "The camera isn't available. Choose a photo of the QR instead, or paste the link below."}</p>}
      </div>
      <label className="mx-auto flex w-fit cursor-pointer items-center gap-2 rounded-full bg-[#141716]/[0.06] px-4 py-2 text-[14px] font-medium transition-transform active:scale-95">
        <ImageUp className="size-4" />Choose a photo of a QR
        <input type="file" accept="image/*" className="sr-only" aria-label="Choose a photo of a QR code" onChange={e => fromPhoto(e.target.files?.[0])} />
      </label>
    </div>
  );
}
