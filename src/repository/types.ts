// Row shapes the repositories return.

export type UserRow = {
  id: string; username: string; display_name: string; email: string | null;
  pin_hash: string | null; pin_failures: number | null; pin_locked_until: number | null; legacy: number; google_sub?: string | null;
};
// The signed-in person (from the session cookie).
export type CurrentUser = {
  id: string; name: string; username: string; email: string | null; legacy: boolean; hasPin: boolean; google: boolean; emailVerified: boolean;
  siteAdmin: boolean; adminUnlocked: boolean; tokenHash: string;
};
export type MemberStatus = "active" | "pending" | "invited" | "suggested" | "removed";
export type Role = "admin" | "member";
export type GroupMember = { id: string; name: string; role: Role; status: MemberStatus; username: string | null; active: boolean };
export type ShareRow = { memberId: string; amountCents: number };
export type EmailTokenRow = { token_hash: string; user_id: string; email: string; expires_at: number; used_at: number | null; currentEmail: string | null; username: string; display_name: string };
export type PaymentMethodRow = { member_id: string; kind: string; upi_id: string | null; qr_mime: string | null; qr_base64: string | null; updated_at: number | null };
export type SettlementRow = { id: string; fromId: string; toId: string; cents: number; status: string; createdBy: string; createdAt: number };
export type HistoryRow = { id: string; group_id: string; entity: "expense" | "payment"; entity_id: string; action: "created" | "edited" | "deleted" | "cancelled"; actor_id: string; before_json: string | null; after_json: string | null; created_at: number };
