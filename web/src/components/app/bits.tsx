import * as React from "react";
import { useIsFetching, useIsMutating } from "@tanstack/react-query";
import { m, useReducedMotion } from "motion/react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { inr, shortDate } from "@/lib/money";

export const EASE = [0.22, 1, 0.36, 1] as const;

const AVATAR_HUES = [274, 160, 28, 300, 200, 85, 340, 240];
export function PersonAvatar({ id, name, size = "md", className }: { id: string; name: string; size?: "sm" | "md" | "lg"; className?: string }) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hue = AVATAR_HUES[h % AVATAR_HUES.length];
  const initials = name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase() || "?";
  return (
    <span
      aria-hidden="true"
      className={cn("inline-grid shrink-0 place-items-center rounded-full font-semibold text-white shadow-sm",
        size === "sm" && "size-8 text-[11px]", size === "md" && "size-10 text-[13px]", size === "lg" && "size-14 text-lg", className)}
      style={{ background: `linear-gradient(135deg, oklch(0.62 0.17 ${hue}), oklch(0.5 0.19 ${hue + 20}))` }}
    >
      {initials}
    </span>
  );
}

// Money with direction colour: positive = coming to you, negative = you owe.
export function Amount({ cents, signed = false, className }: { cents: number; signed?: boolean; className?: string }) {
  return (
    <span className={cn("tabular font-semibold", signed && cents > 0 && "text-positive", signed && cents < 0 && "text-negative", className)}>
      {signed && cents > 0 ? "+" : ""}{inr(cents)}
    </span>
  );
}

// Counts up/down to the new amount with an ease-out curve.
export function AnimatedAmount({ cents, className }: { cents: number; className?: string }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = React.useState(cents);
  const from = React.useRef(cents);
  React.useEffect(() => {
    const start = from.current;
    if (reduce || start === cents) { from.current = cents; setShown(cents); return; }
    let frame = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / 600), eased = 1 - Math.pow(1 - p, 3);
      const v = Math.round(start + (cents - start) * eased);
      from.current = v;
      setShown(v);
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [cents, reduce]);
  return <span className={cn("tabular", className)}>{inr(shown)}</span>;
}

type LoadingButtonProps = React.ComponentProps<typeof Button> & { loading?: boolean; loadingText?: string };
// Disabled with a spinner while its request runs, so taps never feel lost or double-submit.
export function LoadingButton({ loading, loadingText, children, disabled, ...props }: LoadingButtonProps) {
  return (
    <Button {...props} disabled={disabled || loading} aria-busy={loading || undefined}>
      {loading && <Loader2 className="animate-spin" />}
      {loading && loadingText ? loadingText : children}
    </Button>
  );
}

export function DateBadge({ ts }: { ts: number }) {
  const d = shortDate(ts);
  return (
    <span title={d.full} className="flex w-10 flex-col items-center leading-none">
      <span className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">{d.month}</span>
      <span className="tabular mt-0.5 text-lg font-bold">{d.day}</span>
    </span>
  );
}

export function Segmented<T extends string>({ value, onChange, options, id, className, dark }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode }[]; id: string; className?: string; dark?: boolean;
}) {
  return (
    <div role="tablist" className={cn("relative grid rounded-xl p-1", dark ? "bg-white/10" : "bg-muted", className)} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map(o => {
        const active = o.value === value;
        return (
          <button key={o.value} type="button" role="tab" aria-selected={active} onClick={() => onChange(o.value)}
            className={cn("relative z-10 h-9 cursor-pointer rounded-lg px-2 text-[13px] font-semibold transition-colors",
              active ? (dark ? "text-hero" : "text-foreground") : dark ? "text-white/70 hover:text-white" : "text-muted-foreground hover:text-foreground")}>
            {active && <m.span layoutId={id} className={cn("absolute inset-0 -z-10 rounded-lg shadow-sm", dark ? "bg-white" : "bg-card dark:bg-white/15")} transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// Thin bar under the top bar while any request is in flight.
export function TopProgress() {
  const busy = useIsFetching() + useIsMutating() > 0;
  return (
    <div aria-hidden="true" className={cn("pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden transition-opacity duration-300", busy ? "opacity-100" : "opacity-0")}>
      <div className="h-full w-1/3 bg-gradient-to-r from-transparent via-primary to-transparent" style={{ animation: "loadbar 1.1s ease-in-out infinite" }} />
    </div>
  );
}

export function Page({ children, className }: { children: React.ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <m.main
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: EASE }}
      className={cn("mx-auto w-full max-w-2xl px-4 pt-4 pb-28", className)}
    >
      {children}
    </m.main>
  );
}

export function EmptyState({ icon, title, children }: { icon: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <div className="mb-3 grid size-12 place-items-center rounded-2xl bg-accent text-accent-foreground">{icon}</div>
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-1 max-w-xs text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-end justify-between gap-3 px-1">
      <h2 className="text-[13px] font-semibold tracking-wide text-muted-foreground uppercase">{children}</h2>
      {action}
    </div>
  );
}

export const listItem = {
  initial: { opacity: 0, y: 8 },
  animate: (i: number) => ({ opacity: 1, y: 0, transition: { delay: Math.min(i, 10) * 0.03, duration: 0.28, ease: EASE } }),
  exit: { opacity: 0, transition: { duration: 0.15 } },
};
