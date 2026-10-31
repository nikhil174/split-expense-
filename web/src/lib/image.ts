// Shrinks a photo or screenshot of a QR code before upload: at most 720px on
// the long side, PNG if that is small enough (sharpest for QR codes), else
// JPEG at decreasing quality. Stays well under the server's 300 KB limit.
const MAX_SIDE = 720, MAX_BYTES = 280 * 1024;

const dataUrlBytes = (url: string) => Math.floor((url.length - url.indexOf(",") - 1) * 3 / 4);

export function shrinkQrImage(file: File): Promise<string> {
  return shrinkImage(file, { what: "your UPI QR code", maxSide: MAX_SIDE });
}

// Payment screenshots are taller (phone screens), so allow more height.
export function shrinkScreenshot(file: File): Promise<string> {
  return shrinkImage(file, { what: "the payment screenshot", maxSide: 1280 });
}

async function shrinkImage(file: File, { what, maxSide }: { what: string; maxSide: number }): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error(`Choose an image of ${what}.`);
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("That image could not be opened. Try a screenshot of your QR code."));
      el.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff"; // transparent areas become white, as on a printed QR
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const png = canvas.toDataURL("image/png");
    if (dataUrlBytes(png) <= MAX_BYTES) return png;
    for (const q of [0.92, 0.85, 0.75, 0.6, 0.45]) {
      const jpg = canvas.toDataURL("image/jpeg", q);
      if (dataUrlBytes(jpg) <= MAX_BYTES) return jpg;
    }
    throw new Error(`That image is too large. Try a smaller screenshot of ${what}.`);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// upi:// link that opens GPay, PhonePe, Paytm etc. with the payee (and amount) filled in.
// The UPI ID is kept as typed (it is validated to letters, digits, . _ - and
// one @), since some UPI apps do not decode an encoded "@".
export function upiPayLink({ upiId, name, amount, note }: { upiId: string; name: string; amount?: string; note?: string }) {
  const parts = [`pa=${upiId}`, `pn=${encodeURIComponent(name)}`, "cu=INR"];
  if (amount) parts.push(`am=${amount}`);
  if (note) parts.push(`tn=${encodeURIComponent(note)}`);
  return "upi://pay?" + parts.join("&");
}
