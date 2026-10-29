import * as React from "react";
import { useIsFetching, useIsMutating } from "@tanstack/react-query";
import { m, useReducedMotion } from "motion/react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { inr, shortDate } from "@/lib/money";

// iOS-like motion: quick ease-out for content, a firm spring for controls.
export const EASE = [0.25, 0.1, 0.25, 1] as const;
export const SPRING = { type: "spring", stiffness: 600, damping: 45, mass: 0.7 } as const;

// A short tap on Android when something important succeeds. No-op elsewhere.
export function haptic(pattern: number | number[] = 12) {
  try { navigator.vibrate?.(pattern); } catch { /* unsupported */ }
}

// iOS Contacts-style monogram: grey gradient disc, white initials.
export function PersonAvatar({ name, size = "md", className }: { id?: string; name: string; size?: "sm" | "md" | "lg"; className?: string }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase() || "?";
  return (
    <span aria-hidden="true" className={cn("inline-grid shrink-0 place-items-center rounded-full bg-gradient-to-b from-[#a5abb8] to-[#858994] font-rounded font-semibold text-white",
      size === "sm" && "size-8 text-[13px]", size === "md" && "size-10 text-[15px]", size === "lg" && "size-[60px] text-[24px]", className)}>
      {initials}
    </span>
  );
}

// Large amounts in SF Pro Rounded bold, paise smaller (Apple Cash style).
export function Money({ cents, size = "md", className, sign }: { cents: number; size?: "md" | "lg" | "xl" | "hero"; className?: string; sign?: boolean }) {
  const abs = Math.abs(cents);
  const rupees = Math.floor(abs / 100).toLocaleString("en-IN");
  const paise = String(abs % 100).padStart(2, "0");
  const sizes = { md: "text-[17px] font-semibold", lg: "text-[28px] font-bold", xl: "text-[40px] font-bold", hero: "text-[48px] font-bold" };
  return (
    // Plain inline spans (not flex) so it reads and copies as "₹992.50".
    <span className={cn("tabular inline-block font-rounded leading-none tracking-[-0.02em] whitespace-nowrap", sizes[size], className)}>
      {sign && cents < 0 && "−"}₹{rupees}<span className={size === "md" ? "" : "text-[0.6em] opacity-70"}>.{paise}</span>
    </span>
  );
}

// Plain amount for tables and lists.
export function Amount({ cents, signed = false, className }: { cents: number; signed?: boolean; className?: string }) {
  return (
    <span className={cn("tabular", signed && cents > 0 && "text-positive", signed && cents < 0 && "text-negative", className)}>
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
      const p = Math.min(1, (t - t0) / 600), eased = 1 - Math.pow(1 - p, 3);
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

// iOS Calendar-icon style date: red month, large day.
export function DateBadge({ ts }: { ts: number }) {
  const d = shortDate(ts);
  return (
    <span title={d.full} className="flex w-9 flex-col items-center leading-none">
      <span className="text-[10px] font-semibold text-negative uppercase">{d.month}</span>
      <span className="tabular mt-0.5 text-[20px] font-light">{d.day}</span>
    </span>
  );
}

// iOS segmented control: grey track, white thumb that springs between segments.
export function Segmented<T extends string>({ value, onChange, options, id, className }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode }[]; id: string; className?: string;
}) {
  return (
    <div role="tablist" className={cn("relative grid rounded-[9px] bg-muted p-[2px]", className)} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map(o => {
        const active = o.value === value;
        return (
          <button key={o.value} type="button" role="tab" aria-selected={active} onClick={() => { if (!active) { haptic(6); onChange(o.value); } }}
            className={cn("relative z-10 h-8 cursor-pointer truncate rounded-[7px] px-2 text-[13px] text-foreground transition-[font-weight] duration-150", active ? "font-semibold" : "font-medium")}>
            {active && <m.span layoutId={id} className="absolute inset-0 -z-10 rounded-[7px] bg-white shadow-[0_3px_8px_rgba(0,0,0,0.12),0_3px_1px_rgba(0,0,0,0.04)] dark:bg-[#636366]" transition={SPRING} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// Thin tint progress line under the navigation bar while requests are in flight.
export function TopProgress() {
  const busy = useIsFetching() + useIsMutating() > 0;
  return (
    <div aria-hidden="true" className={cn("pointer-events-none absolute inset-x-0 bottom-0 h-[2px] overflow-hidden transition-opacity duration-300", busy ? "opacity-100" : "opacity-0")}>
      <div className="h-full w-1/3 bg-gradient-to-r from-transparent via-tint to-transparent" style={{ animation: "loadbar 1.1s ease-in-out infinite" }} />
    </div>
  );
}

export function Page({ children, className }: { children: React.ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <m.main
      initial={reduce ? false : { opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
      className={cn("mx-auto w-full max-w-2xl px-4 pt-3 pb-28", className)}
    >
      {children}
    </m.main>
  );
}

export function EmptyState({ icon, title, children }: { icon: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <div className="mb-3 grid size-14 place-items-center rounded-full bg-muted text-muted-foreground [&_svg]:size-6">{icon}</div>
      <p className="title-2">{title}</p>
      {children && <div className="subhead mt-1.5 max-w-xs text-muted-foreground">{children}</div>}
    </div>
  );
}

// Grouped-table section header.
export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-1.5 flex items-end justify-between gap-3 px-4">
      <h2 className="eyebrow">{children}</h2>
      {action}
    </div>
  );
}

// Section footer text under a grouped list.
export function Footnote({ children }: { children: React.ReactNode }) {
  return <p className="footnote mt-1.5 px-4 text-muted-foreground">{children}</p>;
}

// iOS inset-grouped list. Separators are inset to line up with the text
// (`inset` = px from the left edge, e.g. 70 for rows with a 40px avatar).
export function List({ children, className, inset = 16 }: { children: React.ReactNode; className?: string; inset?: number }) {
  return (
    <div style={{ "--sep": inset + "px" } as React.CSSProperties}
      className={cn("panel overflow-hidden [&>*]:relative [&>*:not(:last-child)]:after:absolute [&>*:not(:last-child)]:after:right-0 [&>*:not(:last-child)]:after:bottom-0 [&>*:not(:last-child)]:after:left-[var(--sep)] [&>*:not(:last-child)]:after:h-px [&>*:not(:last-child)]:after:origin-bottom [&>*:not(:last-child)]:after:scale-y-50 [&>*:not(:last-child)]:after:bg-hairline [&>*:not(:last-child)]:after:content-['']", className)}>
      {children}
    </div>
  );
}

export const rowClass = "flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left";
// iOS cell highlight on press (no hover tint on touch devices).
export const pressableRow = cn(rowClass, "cursor-pointer transition-colors duration-100 active:bg-[#d1d1d6] dark:active:bg-[#3a3a3c] [@media(hover:hover)]:hover:bg-muted/60");

export const listItem = {
  initial: { opacity: 0 },
  animate: (i: number) => ({ opacity: 1, transition: { delay: Math.min(i, 10) * 0.025, duration: 0.25, ease: EASE } }),
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

// iOS text field: white (dark: #1C1C1E) on the grouped background, no border.
export const fieldClass = "h-11 w-full rounded-[10px] border-0 bg-card px-4 text-[17px] text-foreground shadow-none outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-tint/40 disabled:opacity-50";
// iOS search field: grey fill, magnifier inset.
export const searchFieldClass = "h-9 w-full rounded-[10px] border-0 bg-muted pl-8 pr-3 text-[17px] shadow-none outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-tint/40";

// App mark: a blue iOS-style app icon with "Split".
export function Wordmark({ large }: { large?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={cn("grid place-items-center bg-gradient-to-b from-[#40a0ff] to-[#007aff] text-white shadow-sm", large ? "size-16 rounded-[15px]" : "size-7 rounded-[7px]")}>
        <svg viewBox="0 0 24 24" className={large ? "size-8" : "size-4"} fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round"><path d="M6 16 18 8M11 8h7v7" /></svg>
      </span>
      {!large && <span className="text-[17px] font-semibold tracking-[-0.02em]">Split</span>}
    </span>
  );
}

const CHEVRON = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238e8e93' stroke-width='2.4'%3E%3Cpath d='m7 10 5 5 5-5'/%3E%3C/svg%3E\")";
// Native <select> (best on Android) styled like the other fields.
export function NativeSelect({ className, style, ...props }: React.ComponentProps<"select">) {
  // Chevron set inline: arbitrary bg-* classes would make tailwind-merge drop the field's background colour.
  return <select {...props} className={cn(fieldClass, "cursor-pointer appearance-none pr-9", className)} style={{ backgroundImage: CHEVRON, backgroundSize: "18px", backgroundPosition: "right 0.75rem center", backgroundRepeat: "no-repeat", ...style }} />;
}
