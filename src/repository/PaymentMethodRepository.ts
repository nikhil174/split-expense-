// appx_payment_methods: how each person gets paid (UPI ID and QR image).
import type { PaymentMethodRow } from "./types.ts";

export class PaymentMethodRepository {
  private readonly db: D1Database;
  constructor(db: D1Database) { this.db = db; }

  upiOf(uid: string) { return this.db.prepare("SELECT * FROM appx_payment_methods WHERE member_id=? AND kind='upi'").bind(uid).first<PaymentMethodRow>(); }
  qrOf(uid: string) { return this.db.prepare("SELECT qr_mime,qr_base64 FROM appx_payment_methods WHERE member_id=? AND kind='upi'").bind(uid).first<{ qr_mime: string; qr_base64: string | null }>(); }
  async upiOfMany(ids: string[]): Promise<PaymentMethodRow[]> {
    return ids.length ? (await this.db.prepare("SELECT * FROM appx_payment_methods WHERE kind='upi' AND member_id IN (" + ids.map(() => "?").join(",") + ")").bind(...ids).all<PaymentMethodRow>()).results : [];
  }
  // Sets the UPI ID; keepQr leaves the stored QR image as it is.
  saveUpi(uid: string, upiId: string, qr: { mime: string; base64: string } | null, keepQr: boolean, now: number) {
    return this.db.prepare("INSERT INTO appx_payment_methods(member_id,kind,upi_id,qr_mime,qr_base64,updated_at) VALUES(?1,'upi',?2,?3,?4,?5) ON CONFLICT(member_id,kind) DO UPDATE SET upi_id=excluded.upi_id,updated_at=excluded.updated_at"
      + (keepQr ? "" : ",qr_mime=excluded.qr_mime,qr_base64=excluded.qr_base64"))
      .bind(uid, upiId, qr?.mime ?? null, qr?.base64 ?? null, now).run();
  }
  deleteAll(uid: string) { return this.db.prepare("DELETE FROM appx_payment_methods WHERE member_id=?").bind(uid).run(); }
}
