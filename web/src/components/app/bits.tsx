import * as React from "react";
import { useIsFetching, useIsMutating } from "@tanstack/react-query";
import { m, useReducedMotion } from "motion/react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { inr, shortDate } from "@/lib/money";

export const EASE = [0.22, 1, 0.36, 1] as const;
export const SPRING = { type: "spring", stiffness: 520, damping: 40, mass: 0.8 } as const;

// A short tap on Android when something important succeeds. No-op elsewhere.
export function haptic(pattern: number | number[] = 12) {
  try { navigator.vibrate?.(pattern); } catch { /* unsupported */ }
}

// Quiet, desaturated monogram tones; every person gets a stable one.
const TONES = [
  "bg-[oklch(0.9_0.03_80)] text-[oklch(0.38_0.05_75)] dark:bg-[oklch(0.3_0.03_80)] dark:text-[oklch(0.88_0.05_82)]",
  "bg-[oklch(0.9_0.03_160)] text-[oklch(0.36_0.05_160)] dark:bg-[oklch(0.29_0.03_160)] dark:text-[oklch(0.86_0.05_160)]",
  "bg-[oklch(0.9_0.025_250)] text-[oklch(0.38_0.05_255)] dark:bg-[oklch(0.29_0.03_255)] dark:text-[oklch(0.86_0.04_250)]",
  "bg-[oklch(0.9_0.03_35)] text-[oklch(0.42_0.07_35)] dark:bg-[oklch(0.3_0.035_35)] dark:text-[oklch(0.86_0.05_40)]",
  "bg-[oklch(0.9_0.025_320)] text-[oklch(0.4_0.05_320)] dark:bg-[oklch(0.29_0.03_320)] dark:text-[oklch(0.86_0.04_320)]",
  "bg-[oklch(0.91_0.01_80)] text-[oklch(0.35_0.01_70)] dark:bg-[oklch(0.28_0.005_70)] dark:text-[oklch(0.9_0.01_80)]",
];
export function PersonAvatar({ id, name, size = "md", className }: { id: string; name: string; size?: "sm" | "md" | "lg"; className?: string }) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const initials = name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase() || "?";
  return (
    <span aria-hidden="true" className={cn("inline-grid shrink-0 place-items-center rounded-full font-medium tracking-wide ring-1 ring-hairline ring-inset",
      size === "sm" && "size-8 text-[11px]", size === "md" && "size-10 text-[12.5px]", size === "lg" && "size-14 text-base", TONES[h % TONES.length], className)}>
      {initials}
    </span>
  );
}

// Serif amount with the paise set smaller and quieter: "₹992.50" → ₹992·50.
export function Money({ cents, size = "md", className, sign }: { cents: number; size?: "md" | "lg" | "xl" | "hero"; className?: string; sign?: boolean }) {
  const abs = Math.abs(cents);
  const rupees = Math.floor(abs / 100).toLocaleString("en-IN");
  const paise = String(abs % 100).padStart(2, "0");
  const sizes = { md: "text-[22px]", lg: "text-[32px]", xl: "text-[44px]", hero: "text-[56px] sm:text-[64px]" };
  return (
    // Plain inline spans (not flex) so it reads and copies as "₹992.50".
    <span className={cn("tabular inline-block font-serif leading-none tracking-[-0.02em] whitespace-nowrap", sizes[size], className)}>
      {sign && cents < 0 && "−"}<span className="pr-[0.06em] text-[0.62em] opacity-70">₹</span>{rupees}<span className="pl-[0.03em] text-[0.5em] opacity-55">.{paise}</span>
    </span>
  );
}

// Plain sans amount for tables and lists.
export function Amount({ cents, signed = false, className }: { cents: number; signed?: boolean; className?: string }) {
  return (
    <span className={cn("tabular font-medium", signed && cents > 0 && "text-positive", signed && cents < 0 && "text-negative", className)}>
      {signed && cents > 0 ? "+" : ""}{inr(cents)}
    </span>
  );
}

function useCountUp(cents: number) {
  const reduce = useReducedMotion();
  const [shown, setShown] = React.useState(cents);
  const from = React.useRef(cents);
  React.useEffect(() => {
    const start = from.current;
    if (reduce || start === cents) { from.current = cents; setShown(cents); return; }
    let frame = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / 700), eased = 1 - Math.pow(1 - p, 4);
      const v = Math.round(start + (cents - start) * eased);
      from.current = v;
      setShown(v);
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [cents, reduce]);
  return shown;
}
export function AnimatedMoney(props: React.ComponentProps<typeof Money>) {
  return <Money {...props} cents={useCountUp(props.cents)} />;
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
    <span title={d.full} className="flex w-9 flex-col items-center leading-none">
      <span className="text-[9.5px] font-medium tracking-[0.14em] text-muted-foreground uppercase">{d.month}</span>
      <span className="tabular mt-1 font-serif text-[22px] leading-none">{d.day}</span>
    </span>
  );
}

// Pill switch for two or three choices (sign-in mode, split mode).
export function Segmented<T extends string>({ value, onChange, options, id, className }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode }[]; id: string; className?: string;
}) {
  return (
    <div role="tablist" className={cn("relative grid rounded-full bg-muted p-1 ring-1 ring-hairline ring-inset", className)} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map(o => {
        const active = o.value === value;
        return (
          <button key={o.value} type="button" role="tab" aria-selected={active} onClick={() => onChange(o.value)}
            className={cn("relative z-10 h-9 cursor-pointer rounded-full px-3 text-[13px] font-medium transition-colors duration-200", active ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
            {active && <m.span layoutId={id} className="absolute inset-0 -z-10 rounded-full bg-card shadow-[0_1px_2px_oklch(0_0_0/12%)] ring-1 ring-border" transition={SPRING} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// Text tabs with a sliding brass underline (group sections, admin sections).
export function UnderlineTabs<T extends string>({ value, onChange, options, id, className }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode }[]; id: string; className?: string;
}) {
  return (
    <div role="tablist" className={cn("no-scrollbar flex gap-6 overflow-x-auto border-b border-hairline", className)}>
      {options.map(o => {
        const active = o.value === value;
        return (
          <button key={o.value} type="button" role="tab" aria-selected={active} onClick={() => { if (!active) { haptic(6); onChange(o.value); } }}
            className={cn("relative shrink-0 cursor-pointer pt-2 pb-3 text-[14px] font-medium transition-colors duration-200", active ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
            {o.label}
            {active && <m.span layoutId={id} className="absolute inset-x-0 -bottom-px h-[2px] rounded-full bg-brass" transition={SPRING} />}
          </button>
        );
      })}
    </div>
  );
}

// Hairline progress under the top bar while any request is in flight.
export function TopProgress() {
  const busy = useIsFetching() + useIsMutating() > 0;
  return (
    <div aria-hidden="true" className={cn("pointer-events-none absolute inset-x-0 bottom-0 h-px overflow-hidden transition-opacity duration-300", busy ? "opacity-100" : "opacity-0")}>
      <div className="h-full w-1/3 bg-gradient-to-r from-transparent via-brass to-transparent" style={{ animation: "loadbar 1.2s cubic-bezier(.4,0,.2,1) infinite" }} />
    </div>
  );
}

export function Page({ children, className }: { children: React.ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <m.main
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE }}
      className={cn("mx-auto w-full max-w-2xl px-5 pt-5 pb-28", className)}
    >
      {children}
    </m.main>
  );
}

export function EmptyState({ icon, title, children }: { icon: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className="mb-4 grid size-11 place-items-center rounded-full text-muted-foreground ring-1 ring-border">{icon}</div>
      <p className="font-serif text-[22px] leading-tight">{title}</p>
      {children && <div className="mt-1.5 max-w-xs text-[13.5px] leading-relaxed text-muted-foreground">{children}</div>}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-2.5 flex items-end justify-between gap-3 px-1">
      <h2 className="eyebrow">{children}</h2>
      {action}
    </div>
  );
}

// Grouped list container (iOS-style inset group with hairline separators).
export function List({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("panel divide-y divide-hairline overflow-hidden", className)}>{children}</div>;
}

export const rowClass = "flex w-full items-center gap-3.5 px-4 py-3.5 text-left";
export const pressableRow = cn(rowClass, "cursor-pointer transition-colors duration-150 hover:bg-muted/50 active:bg-muted");

export const listItem = {
  initial: { opacity: 0, y: 6 },
  animate: (i: number) => ({ opacity: 1, y: 0, transition: { delay: Math.min(i, 10) * 0.035, duration: 0.35, ease: EASE } }),
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

// Shared field styling for inputs and native selects.
export const fieldClass = "h-12 w-full rounded-xl border border-input bg-surface px-4 text-[15px] shadow-none outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-muted-foreground/70 focus-visible:border-brass/70 focus-visible:ring-[3px] focus-visible:ring-brass/15 disabled:opacity-60";

// Serif wordmark with a brass full stop.
export function Wordmark({ large }: { large?: boolean }) {
  return (
    <span className={large ? "font-serif text-[30px] leading-none tracking-[-0.02em]" : "font-serif text-[22px] leading-none tracking-[-0.02em]"}>
      Split<span className="text-brass italic">.</span>
    </span>
  );
}

const CHEVRON = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")";
// Native <select> (best on Android) styled like the other fields.
export function NativeSelect({ className, style, ...props }: React.ComponentProps<"select">) {
  return <select {...props} className={cn(fieldClass, "cursor-pointer appearance-none bg-[length:16px] bg-[right_0.9rem_center] bg-no-repeat pr-9", className)} style={{ backgroundImage: CHEVRON, ...style }} />;
}
