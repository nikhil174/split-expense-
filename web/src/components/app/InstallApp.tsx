import * as React from "react";
import { Download, MoreVertical, Plus, Share } from "lucide-react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useInstall } from "@/lib/install";

// "Install app": on Android Chrome it opens Chrome's install dialog straight
// away; on iPhone (Safari or Chrome) and elsewhere it explains the few taps.
export function useInstallApp() {
  const install = useInstall();
  const [open, setOpen] = React.useState(false);
  const start = async () => {
    if (install.canPrompt) {
      if (await install.prompt()) toast.success("Split It is on your home screen.");
      return;
    }
    setOpen(true);
  };
  const dialog = <InstallSteps open={open} onClose={() => setOpen(false)} platform={install.platform} />;
  return { available: !install.isInstalled, start, dialog };
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[#141716] text-[12px] font-semibold text-white">{n}</span>
      <span className="pt-0.5 text-[15px] leading-6">{children}</span>
    </li>
  );
}
const Key = ({ children }: { children: React.ReactNode }) => (
  <span className="mx-0.5 inline-flex items-center gap-1 rounded-md bg-[#141716]/[0.06] px-1.5 py-0.5 align-middle text-[13.5px] font-medium [&_svg]:size-4">{children}</span>
);

function InstallSteps({ open, onClose, platform }: { open: boolean; onClose: () => void; platform: ReturnType<typeof useInstall>["platform"] }) {
  return (
    <AlertDialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <AlertDialogContent className="max-w-[380px] rounded-[26px] border-0 p-6">
        <AlertDialogHeader>
          <AlertDialogTitle className="title-2">Install Split It</AlertDialogTitle>
          <AlertDialogDescription>Add it to your home screen. It opens full screen, like any other app.</AlertDialogDescription>
        </AlertDialogHeader>
        <ol className="space-y-3 text-left">
          {platform === "ios-safari" ? (
            <>
              <Step n={1}>At the bottom of Safari, tap <Key><Share />Share</Key></Step>
              <Step n={2}>Scroll down and tap <Key><Plus />Add to Home Screen</Key></Step>
              <Step n={3}>Tap <Key>Add</Key> at the top right</Step>
            </>
          ) : platform === "ios-other" ? (
            <>
              <Step n={1}>Next to the address bar, tap <Key><Share />Share</Key></Step>
              <Step n={2}>Tap <Key><Plus />Add to Home Screen</Key>, then <Key>Add</Key></Step>
              <Step n={3}>Don't see it? Open this page in Safari and add it from there</Step>
            </>
          ) : platform === "android" ? (
            <>
              <Step n={1}>At the top right of Chrome, tap the menu <Key><MoreVertical /></Key></Step>
              <Step n={2}>Tap <Key><Download />Install app</Key> or <Key>Add to Home screen</Key></Step>
              <Step n={3}>Tap <Key>Install</Key></Step>
            </>
          ) : (
            <>
              <Step n={1}>In Chrome or Edge, click the install icon <Key><Download /></Key> in the address bar</Step>
              <Step n={2}>Click <Key>Install</Key></Step>
              <Step n={3}>On a phone, open this page in Chrome (Android) or Safari (iPhone)</Step>
            </>
          )}
        </ol>
        <AlertDialogFooter>
          <AlertDialogCancel variant="default" className="h-11 w-full rounded-full text-[15px]">Got it</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
