import * as React from "react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, LazyMotion } from "motion/react";
import { LogOut } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PersonAvatar, Segmented, TopProgress, Wordmark } from "@/components/app/bits";
import { AuthScreen } from "@/features/auth/AuthScreen";
import { GroupsScreen } from "@/features/groups/GroupsScreen";
import { GroupScreen } from "@/features/groups/GroupScreen";
import { PersonScreen } from "@/features/groups/PersonScreen";
import { AdminScreen } from "@/features/admin/AdminScreen";
import { keys, useMe } from "@/hooks/queries";
import { ApiError, post } from "@/lib/api";
import { navigate, useRoute } from "@/lib/route";

const loadMotionFeatures = () => import("@/lib/motion-features").then(m => m.default);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      // Don't hammer the API with retries for auth or validation errors.
      retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
    },
  },
});

// A 401 anywhere means the session ended: drop back to sign-in.
queryClient.getQueryCache().subscribe(event => {
  const err = event.query.state.error;
  if (event.type === "updated" && err instanceof ApiError && err.status === 401 && event.query.queryKey[0] !== "me") {
    queryClient.invalidateQueries({ queryKey: keys.me });
  }
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <LazyMotion features={loadMotionFeatures} strict>
        <Root />
      </LazyMotion>
      <Toaster position="bottom-center" offset={{ bottom: 100 }} mobileOffset={{ bottom: 100, left: 16, right: 16 }} toastOptions={{ classNames: { toast: "!rounded-[20px] !border-0 !bg-[#141716]/95 !text-white !text-[14px] !shadow-[0_14px_36px_-10px_rgb(0_0_0/40%)] backdrop-blur-xl", description: "!text-white/70", success: "[&_[data-icon]]:!text-[#8fd6b8]", error: "[&_[data-icon]]:!text-[#f2a492]" } }} />
    </QueryClientProvider>
  );
}

function Splash() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <span className="animate-pulse"><Wordmark large /></span>
    </div>
  );
}

function Root() {
  const me = useMe();
  if (me.isPending) return <Splash />;
  const user = me.data?.admin || me.data?.member;
  if (!user) return <AuthScreen />;
  return <Shell user={user} isAdmin={!!me.data?.admin} />;
}

function Shell({ user, isAdmin }: { user: { id: string; name: string }; isAdmin: boolean }) {
  const route = useRoute();
  const qc = useQueryClient();
  const [signingOut, setSigningOut] = React.useState(false);
  // Members never see the admin view.
  React.useEffect(() => { if (route.name === "admin" && !isAdmin) navigate({ name: "home" }, { replace: true }); }, [route.name, isAdmin]);

  const signOut = async () => {
    setSigningOut(true);
    try {
      await Promise.allSettled([post("/api/admin/logout"), post("/api/logout")]);
      // Mark the session signed out right away so Root swaps to the sign-in
      // screen, then drop everything cached for the previous user.
      await qc.cancelQueries();
      qc.setQueryData(keys.me, { admin: null, member: null });
      qc.removeQueries({ predicate: q => q.queryKey[0] !== "me" });
      navigate({ name: "home" }, { replace: true });
    } finally { setSigningOut(false); }
  };

  const view = route.name === "admin" ? "admin" : "groups";
  const screenKey = route.name === "group" ? "group-" + route.groupId : route.name === "person" ? "person-" + route.groupId + route.memberId : route.name;
  return (
    <div className="min-h-dvh overflow-x-clip">
      <header className="sticky top-0 z-30 bg-[#f7f7f5]/70 pt-[env(safe-area-inset-top)] backdrop-blur-2xl backdrop-saturate-150">
        <div className="mx-auto flex h-[58px] max-w-2xl items-center gap-3 px-4">
          <button type="button" onClick={() => navigate({ name: isAdmin && view === "admin" ? "admin" : "home" })} className="flex cursor-pointer items-baseline gap-1.5" aria-label="Home">
            <Wordmark />
          </button>
          <div className="flex flex-1 justify-end">
            {isAdmin && (
              <Segmented id="view-switch" className="w-[164px]" value={view} onChange={v => navigate({ name: v === "admin" ? "admin" : "home" })}
                options={[{ value: "groups", label: "Home" }, { value: "admin", label: "Admin" }]} />
            )}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="cursor-pointer rounded-full transition-transform active:scale-95" aria-label="Account"><PersonAvatar id={user.id} name={user.name} size="sm" /></button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60 rounded-[18px] border-white/80 bg-white/95 p-1.5 shadow-[0_16px_40px_-12px_rgb(16_40_32/25%)] backdrop-blur-xl">
              <DropdownMenuLabel className="font-normal">
                <p className="headline">{user.name}</p>
                <p className="text-xs text-muted-foreground">{isAdmin ? "Administrator · also a member" : "Member"}</p>
                <p className="mt-1.5 text-[11px] text-muted-foreground/70">Build {__BUILD__}</p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={e => { e.preventDefault(); signOut(); }} disabled={signingOut}><LogOut />{signingOut ? "Signing out…" : "Sign out"}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <TopProgress />
      </header>
      <AnimatePresence mode="wait" initial={false}>
        <React.Fragment key={screenKey}>
          {route.name === "home" && <GroupsScreen name={user.name} />}
          {route.name === "admin" && isAdmin && <AdminScreen adminName={user.name} />}
          {route.name === "group" && <GroupScreen groupId={route.groupId} tab={route.tab} />}
          {route.name === "person" && <PersonScreen groupId={route.groupId} memberId={route.memberId} />}
        </React.Fragment>
      </AnimatePresence>
    </div>
  );
}
