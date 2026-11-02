// Payment methods (UPI only for now): how each person gets paid. A UPI ID
// looks like name@bank; the QR is an image the person uploads (the app
// shrinks it before sending), checked by its actual bytes, not just its
// declared type.
import type { GroupPaymentMethod, PaymentMethod } from "../../shared/api-types.ts";
import { QR_MAX_BYTES, UPI_RE } from "../config/constants.ts";
import { textField } from "../domain/text.ts";
import { ApiError, notFound } from "../http/ApiError.ts";
import type { GroupRepository } from "../repository/GroupRepository.ts";
import type { PaymentMethodRepository } from "../repository/PaymentMethodRepository.ts";
import type { CurrentUser, PaymentMethodRow } from "../repository/types.ts";
import type { GroupScope } from "./GroupService.ts";

// A data: URL image (PNG, JPEG or WebP, at most 300 KB): its real type and data.
export function parseImage(value: unknown, what = "QR code"): { mime: string; base64: string } | { error: string } {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(value || ""));
  if (!m) return { error: `Upload the ${what} as a PNG, JPEG or WebP image.` };
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(m[2]), c => c.charCodeAt(0)); } catch { return { error: `That ${what} could not be read.` }; }
  if (bytes.length > QR_MAX_BYTES) return { error: `That ${what} is too large (max 300 KB).` };
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  const real = starts(0x89, 0x50, 0x4e, 0x47) ? "image/png" : starts(0xff, 0xd8, 0xff) ? "image/jpeg"
    : starts(0x52, 0x49, 0x46, 0x46) && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP" ? "image/webp" : null;
  if (real !== m[1]) return { error: "That file is not a valid PNG, JPEG or WebP image." };
  return { mime: real, base64: m[2] };
}

export const methodOut = (r: PaymentMethodRow | null | undefined): PaymentMethod => ({ kind: "upi", upiId: r?.upi_id || null, hasQr: !!r?.qr_base64, updatedAt: r?.updated_at || null });

export class PaymentMethodService {
  private readonly methods: PaymentMethodRepository;
  private readonly groups: GroupRepository;
  constructor(deps: { methods: PaymentMethodRepository; groups: GroupRepository }) { this.methods = deps.methods; this.groups = deps.groups; }

  // My own payment method (how others pay me), the same in every group.
  async mine(u: CurrentUser) { return { method: methodOut(await this.methods.upiOf(u.id)) }; }

  // qr: a data URL to set it, null to remove it, left out to keep the current one.
  async save(u: CurrentUser, b: any) {
    const upiId = textField(b?.upiId).trim();
    if (!UPI_RE.test(upiId)) throw new ApiError("Enter a valid UPI ID, like name@okbank.");
    let qr: { mime: string; base64: string } | null = null;
    if (b?.qr !== undefined && b?.qr !== null) {
      const parsed = parseImage(b.qr);
      if ("error" in parsed) throw new ApiError(parsed.error);
      qr = parsed;
    }
    await this.methods.saveUpi(u.id, upiId, qr, b?.qr === undefined, Date.now());
    return this.mine(u);
  }

  async myQr(u: CurrentUser) {
    const r = await this.methods.qrOf(u.id);
    if (!r?.qr_base64) throw notFound("No QR code yet.");
    return { mime: r.qr_mime, base64: r.qr_base64 };
  }

  async remove(u: CurrentUser) {
    await this.methods.deleteAll(u.id);
    return { method: methodOut(null) };
  }

  // Everyone in the group and how to pay them (UPI ID, whether a QR exists).
  async inGroup(s: GroupScope): Promise<{ people: GroupPaymentMethod[] }> {
    const members = (await this.groups.members(s.gid)).filter(x => x.active);
    const rows = await this.methods.upiOfMany(members.map(x => x.id));
    const byId = new Map(rows.map(r => [r.member_id, r]));
    return { people: members.map(x => ({ memberId: x.id, name: x.name, isMe: x.id === s.user.id, ...methodOut(byId.get(x.id)) })) };
  }

  // A member's UPI QR image, only for people in the same group.
  async memberQr(s: GroupScope, mid: string) {
    if (!(await this.groups.members(s.gid)).some(x => x.id === mid)) throw notFound("That person is not in this group.");
    const r = await this.methods.qrOf(mid);
    if (!r?.qr_base64) throw notFound("No QR code yet.");
    return { mime: r.qr_mime, base64: r.qr_base64 };
  }
}
