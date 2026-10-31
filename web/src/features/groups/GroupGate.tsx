import * as React from "react";
import { Lock } from "lucide-react";
import { Page } from "@/components/app/bits";
import { GroupPinForm } from "@/components/app/secrets";
import { useGroup } from "@/hooks/queries";
import { ApiError } from "@/lib/api";
import { goBack } from "@/lib/route";
import { BackButton } from "./GroupScreen";

// A group with a PIN opens only after it's entered on this device (the
// server remembers it for a day). Until then, this asks for it instead of
// showing the group or a person in it.
export function GroupGate({ groupId, children }: { groupId: string; children: React.ReactNode }) {
  const group = useGroup(groupId);
  const err = group.error;
  if (!(err instanceof ApiError && err.code === "group_locked")) return <>{children}</>;
  const name = String(err.data.groupName || "this group");
  return (
    <Page>
      <BackButton label="Groups" onClick={() => goBack({ name: "home" })} />
      <div className="panel mx-auto mt-8 max-w-sm space-y-5 p-6 text-center" data-testid="group-locked">
        <span className="mx-auto grid size-14 place-items-center rounded-full bg-[#141716] text-white"><Lock className="size-6" /></span>
        <div>
          <h1 className="title-2 break-words">{name}</h1>
          <p className="mt-1 text-[14px] text-muted-foreground">Enter the group's 4-digit PIN to open it.</p>
        </div>
        <GroupPinForm groupId={groupId} groupName={name} />
      </div>
    </Page>
  );
}
