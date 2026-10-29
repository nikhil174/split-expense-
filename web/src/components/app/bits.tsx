import * as React from "react";
import { useIsFetching, useIsMutating } from "@tanstack/react-query";
import { m, useReducedMotion } from "motion/react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { categoryOf } from "@/lib/category";
import { Sparkles } from "./glitter";
import { inr, shortDate } from "@/lib/money";

// Fluid, slightly springy motion (ColorOS-like), never bouncy.
export const EASE = [0.22, 1, 0.36, 1] as const;
export const SPRING = { type: "spring", stiffness: 420, damping: 34, mass: 0.8 } as const;

// A short tap on Android when something important succeeds. No-op elsewhere.
export function haptic(pattern: number | number[] = 12) {
  try { navigator.vibrate?.(pattern); } catch { /* unsupported */ }
}

// Pastel initials disc; each person keeps a stable colour.
// Quiet, near-neutral tones so people read as a set, not a rainbow.
const PASTELS: [string, string][] = [["#efeee9", "#3b403d"], ["#ecefed", "#334039"], ["#eeedf0", "#3b3a44"], ["#f0ede9", "#45392f"]];
export function PersonAvatar({ id, name, size = "md", className }: { id?: string; name: string; size?: "sm" | "md" | "lg"; className?: string }) {
  let h = 0;
  for (const c of id || name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const [bg, fg] = PASTELS[h % PASTELS.length];
  const initials = name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase() || "?";
  return (
    <span aria-hidden="true" style={{ background: bg, color: fg }}
      className={cn("inline-grid shrink-0 place-items-center rounded-full font-semibold", size === "sm" && "size-8 text-[12px]", size === "md" && "size-10 text-[14px]", size === "lg" && "size-16 text-[22px]", className)}>
      {initials}
    </span>
  );
}

// Coloured icon tile for an expense (food, travel, stay…).
export function CategoryTile({ description, size = "md" }: { description: string; size?: "sm" | "md" }) {
  const c = categoryOf(description);
  const Icon = c.icon;
  return (
    <span aria-hidden="true" className={cn("grid shrink-0 place-items-center rounded-[13px] bg-[#f2f2ef] text-[#3b403d] ring-1 ring-[#141716]/[0.04] ring-inset", size === "md" ? "size-10" : "size-8 rounded-[11px]")}>
      <Icon className={size === "md" ? "size-[18px]" : "size-4"} strokeWidth={1.8} />
    </span>
  );
}

// Big amounts: semibold rupees, paise smaller and lighter.
export function Money({ cents, size = "md", className, sign }: { cents: number; size?: "md" | "lg" | "xl" | "hero"; className?: string; sign?: boolean }) {
  const abs = Math.abs(cents);
  const rupees = Math.floor(abs / 100).toLocaleString("en-IN");
  const paise = String(abs % 100).padStart(2, "0");
  const sizes = { md: "text-[16px] font-medium", lg: "text-[26px] font-medium", xl: "text-[36px] font-medium", hero: "text-[46px] font-medium" };
  return (
    // Plain inline spans (not flex) so it reads and copies as "₹992.50".
    <span className={cn("tabular inline-block leading-none tracking-[-0.03em] whitespace-nowrap", sizes[size], className)}>
      {sign && cents < 0 && "−"}<span className={size === "md" ? "" : "pr-[0.04em] text-[0.62em] font-medium"}>₹</span>{rupees}<span className={size === "md" ? "" : "text-[0.55em] font-medium opacity-75"}>.{paise}</span>
    </span>
  );
}

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
      const p = Math.min(1, (t - t0) / 650), eased = 1 - Math.pow(1 - p, 4);
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
    <span title={d.full} className="flex w-8 flex-col items-center leading-none">
      <span className="tabular text-[17px] font-semibold">{d.day}</span>
      <span className="mt-0.5 text-[10.5px] font-medium text-muted-foreground uppercase">{d.month}</span>
    </span>
  );
}

// Pill segmented control with a white sliding thumb.
export function Segmented<T extends string>({ value, onChange, options, id, className }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode }[]; id: string; className?: string;
}) {
  return (
    <div role="tablist" className={cn("relative grid rounded-full bg-[#141716]/[0.06] p-1", className)} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map(o => {
        const active = o.value === value;
        return (
          <button key={o.value} type="button" role="tab" aria-selected={active} onClick={() => { if (!active) { haptic(6); onChange(o.value); } }}
            className={cn("relative z-10 h-9 cursor-pointer truncate rounded-full px-3 text-[14px] font-medium transition-colors duration-200", active ? "text-foreground" : "text-muted-foreground")}>
            {active && <m.span layoutId={id} className="absolute inset-0 -z-10 rounded-full bg-white shadow-[0_2px_8px_rgb(16_40_32/10%)]" transition={SPRING} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// Floating frosted bottom tab bar with icons (group sections).
export function BottomTabs<T extends string>({ value, onChange, options, id }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string; icon: React.ComponentType<{ className?: string; strokeWidth?: number }> }[]; id: string;
}) {
  return (
    <nav className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-[max(14px,env(safe-area-inset-bottom))]">
      <div role="tablist" className="pointer-events-auto grid w-full max-w-md rounded-[26px] border border-white/80 bg-white/92 p-1.5 shadow-[0_12px_40px_-8px_rgb(16_40_32/28%)] backdrop-blur-2xl backdrop-saturate-150" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
        {options.map(o => {
          const active = o.value === value;
          const Icon = o.icon;
          return (
            <button key={o.value} type="button" role="tab" aria-selected={active} onClick={() => { if (!active) { haptic(6); onChange(o.value); } }}
              className={cn("relative z-10 flex h-[52px] cursor-pointer flex-col items-center justify-center gap-0.5 rounded-[20px] text-[11.5px] font-medium transition-colors duration-200", active ? "text-foreground" : "text-muted-foreground")}>
              {active && <m.span layoutId={id} className="absolute inset-0 -z-10 rounded-[20px] bg-[#141716]/[0.06]" transition={SPRING} />}
              <Icon className="size-[20px]" strokeWidth={active ? 2 : 1.6} />
              {o.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

// Thin green progress line under the top bar while requests are in flight.
export function TopProgress() {
  const busy = useIsFetching() + useIsMutating() > 0;
  return (
    <div aria-hidden="true" className={cn("pointer-events-none absolute inset-x-0 bottom-0 h-[2px] overflow-hidden transition-opacity duration-300", busy ? "opacity-100" : "opacity-0")}>
      <div className="h-full w-1/3 bg-gradient-to-r from-transparent via-[#141716]/60 to-transparent" style={{ animation: "loadbar 1.1s ease-in-out infinite" }} />
    </div>
  );
}

export function Page({ children, className }: { children: React.ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <m.main
      initial={reduce ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.42, ease: EASE }}
      className={cn("mx-auto w-full max-w-2xl px-4 pt-2 pb-32", className)}
    >
      {children}
    </m.main>
  );
}

export function EmptyState({ icon, title, children }: { icon: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <div className="mb-3 grid size-12 place-items-center rounded-full bg-[#141716]/[0.04] text-foreground [&_svg]:size-5 [&_svg]:stroke-[1.7]">{icon}</div>
      <p className="title-2">{title}</p>
      {children && <div className="subhead mt-1.5 max-w-xs text-muted-foreground">{children}</div>}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-end justify-between gap-3 px-2">
      <h2 className="eyebrow">{children}</h2>
      {action}
    </div>
  );
}

export function Footnote({ children }: { children: React.ReactNode }) {
  return <p className="footnote mt-2 px-2 text-muted-foreground">{children}</p>;
}

// Card list with separators inset to line up with the text.
export function List({ children, className, inset = 16 }: { children: React.ReactNode; className?: string; inset?: number }) {
  return (
    <div style={{ "--sep": inset + "px" } as React.CSSProperties}
      className={cn("panel overflow-hidden [&>*]:relative [&>*:not(:last-child)]:after:absolute [&>*:not(:last-child)]:after:right-4 [&>*:not(:last-child)]:after:bottom-0 [&>*:not(:last-child)]:after:left-[var(--sep)] [&>*:not(:last-child)]:after:h-px [&>*:not(:last-child)]:after:bg-hairline [&>*:not(:last-child)]:after:content-['']", className)}>
      {children}
    </div>
  );
}

export const rowClass = "flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left";
export const pressableRow = cn(rowClass, "cursor-pointer transition-colors duration-150 active:bg-[#141716]/[0.05] [@media(hover:hover)]:hover:bg-[#141716]/[0.025]");

export const listItem = {
  initial: { opacity: 0, y: 8 },
  animate: (i: number) => ({ opacity: 1, y: 0, transition: { delay: Math.min(i, 10) * 0.035, duration: 0.35, ease: EASE } }),
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

export const fieldClass = "h-12 w-full rounded-[16px] border border-[#141716]/[0.08] bg-white px-4 text-[15px] text-foreground shadow-[0_1px_2px_rgb(16_40_32/4%)] outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-muted-foreground/70 focus-visible:border-primary/50 focus-visible:ring-[3px] focus-visible:ring-primary/15 disabled:opacity-50";
export const searchFieldClass = "h-11 w-full rounded-full border border-[#141716]/[0.06] bg-white/80 pl-10 pr-4 text-[15px] shadow-[0_1px_2px_rgb(16_40_32/4%)] outline-none placeholder:text-muted-foreground focus-visible:border-primary/50 focus-visible:ring-[3px] focus-visible:ring-primary/15";

// App mark: ink squircle with an arrow, a couple of glints, and "Split It".
export function Wordmark({ large }: { large?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="relative">
        <span className={cn("grid place-items-center bg-[#141716] text-white shadow-[0_6px_16px_-8px_rgb(20_23_22/50%)]", large ? "size-[64px] rounded-[20px]" : "size-8 rounded-[10px]")}>
          <svg viewBox="0 0 24 24" className={large ? "size-8" : "size-4"} fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round"><path d="M6 16 18 8M11 8h7v7" /></svg>
        </span>
        <Sparkles className={large ? "-inset-3" : "-inset-1.5"} glints={large
          ? [{ x: "86%", y: "-8%", size: 18, delay: 0.3 }, { x: "-10%", y: "78%", size: 10, delay: 1.9 }, { x: "102%", y: "60%", size: 8, delay: 2.8, opacity: 0.8 }]
          : [{ x: "84%", y: "-14%", size: 11, delay: 0.6 }, { x: "-12%", y: "74%", size: 6, delay: 2.1, opacity: 0.8 }]} />
      </span>
      {!large && <span className="text-[18px] font-medium tracking-[-0.03em]">Split It</span>}
    </span>
  );
}

const CHEVRON = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23687773' stroke-width='2.2'%3E%3Cpath d='m7 10 5 5 5-5'/%3E%3C/svg%3E\")";
// Native <select> (best on Android) styled like the other fields.
export function NativeSelect({ className, style, ...props }: React.ComponentProps<"select">) {
  // Chevron set inline: arbitrary bg-* classes would make tailwind-merge drop the field's background colour.
  return <select {...props} className={cn(fieldClass, "cursor-pointer appearance-none pr-10", className)} style={{ backgroundImage: CHEVRON, backgroundSize: "18px", backgroundPosition: "right 0.85rem center", backgroundRepeat: "no-repeat", ...style }} />;
}
