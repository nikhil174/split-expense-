import * as React from "react";
import { cn } from "@/lib/utils";

// Champagne four-point star used for every glint.
const STAR = "M12 0C12.6 6.2 17.8 11.4 24 12C17.8 12.6 12.6 17.8 12 24C11.4 17.8 6.2 12.6 0 12C6.2 11.4 11.4 6.2 12 0Z";
const CHAMPAGNE = ["#c9a86a", "#e3cc98", "#b08d4f"];

type Glint = { x: string; y: string; size: number; delay: number; duration?: number; opacity?: number };
const CARD_GLINTS: Glint[] = [
  { x: "84%", y: "12%", size: 15, delay: 0, duration: 3.2 },
  { x: "93%", y: "36%", size: 8, delay: 1.1, opacity: 0.8 },
  { x: "72%", y: "7%", size: 7, delay: 1.9, opacity: 0.75 },
  { x: "64%", y: "26%", size: 5, delay: 2.6, opacity: 0.65 },
  { x: "90%", y: "62%", size: 6, delay: 0.6, opacity: 0.6 },
];

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// A few staggered glints in a corner. With reduced motion on (e.g. Android's
// "Remove animations") they stay visible but still instead of twinkling.
export function Sparkles({ glints = CARD_GLINTS, className }: { glints?: Glint[]; className?: string }) {
  const [still] = React.useState(reducedMotion);
  return (
    <div aria-hidden="true" data-sparkles="" className={cn("pointer-events-none absolute inset-0", className)}>
      {glints.map((g, i) => (
        <svg key={i} viewBox="0 0 24 24" className={cn("absolute", !still && "glint")} width={g.size} height={g.size}
          style={{ left: g.x, top: g.y, opacity: still ? (g.opacity ?? 0.9) * 0.8 : undefined, ["--glint-d" as string]: g.delay + "s", ["--glint-t" as string]: (g.duration ?? 3.4) + "s", ["--glint-o" as string]: g.opacity ?? 0.95 }}>
          <path d={STAR} fill={CHAMPAGNE[i % CHAMPAGNE.length]} />
        </svg>
      ))}
    </div>
  );
}

// A soft band of champagne light that drifts across a card now and then.
export function Sheen() {
  const [still] = React.useState(reducedMotion);
  if (still) return null;
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
      <div className="sheen absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-[#e3cc98]/[0.28] to-transparent" />
    </div>
  );
}

// A brief burst of glitter from a point on screen (defaults to lower centre),
// used when an expense is saved or a payment recorded. Self-removing.
export function glitterBurst({ x, y, strong = false }: { x?: number; y?: number; strong?: boolean } = {}) {
  if (typeof document === "undefined") return;
  const still = reducedMotion();
  const cx = x ?? window.innerWidth / 2, cy = y ?? window.innerHeight * 0.72;
  const layer = document.createElement("div");
  layer.setAttribute("aria-hidden", "true");
  layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:100;overflow:hidden";
  const count = strong ? 26 : 14;
  const palette = ["#c9a86a", "#e3cc98", "#b08d4f", "#1b7a5f", "#141716"];
  for (let i = 0; i < count; i++) {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.5;
    const dist = (strong ? 70 : 50) + Math.random() * (strong ? 110 : 70);
    const size = 4 + Math.random() * (strong ? 8 : 6);
    const star = Math.random() < 0.55;
    const el = document.createElement("div");
    const dx = Math.cos(angle) * dist, dy = Math.sin(angle) * dist;
    el.style.cssText = [
      still
        // Reduced motion: glitter appears already scattered and only fades.
        ? `position:absolute;left:${cx + dx * 0.7}px;top:${cy + dy * 0.7}px;width:${size}px;height:${size}px;transform:translate(-50%,-50%)`
        : `position:absolute;left:${cx}px;top:${cy}px;width:${size}px;height:${size}px;--dx:${dx}px;--dy:${dy + 30}px;--rot:${(Math.random() - 0.5) * 540}deg;animation:glitter-fly ${650 + Math.random() * 450}ms cubic-bezier(0.2,0.7,0.3,1) ${Math.random() * 80}ms forwards`,
      star ? "" : `border-radius:999px;background:${palette[i % palette.length]}`,
    ].join(";");
    if (star) el.innerHTML = `<svg viewBox="0 0 24 24" width="100%" height="100%"><path d="${STAR}" fill="${palette[i % 3]}"/></svg>`;
    layer.appendChild(el);
    // The Web Animations API isn't shortened by the global reduced-motion CSS rule.
    if (still) el.animate?.([{ opacity: 1 }, { opacity: 0 }], { duration: 900, delay: 250, fill: "forwards", easing: "ease-out" });
  }
  document.body.appendChild(layer);
  window.setTimeout(() => layer.remove(), 1400);
}
