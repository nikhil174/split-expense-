// People in a group.
import { FORMER_MEMBER } from "../config/constants.ts";

// id → name for a group's members (anyone not found is a former member).
export function nameLookup(members: readonly { id: string; name: string }[]): (memberId: string) => string {
  const names = new Map(members.map(m => [m.id, m.name]));
  return memberId => names.get(memberId) || FORMER_MEMBER;
}
