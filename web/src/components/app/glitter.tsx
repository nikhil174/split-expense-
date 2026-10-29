import * as React from "react";
import { cn } from "@/lib/utils";

// Champagne four-point star used for every glint.
const STAR = "M12 0C12.6 6.2 17.8 11.4 24 12C17.8 12.6 12.6 17.8 12 24C11.4 17.8 6.2 12.6 0 12C6.2 11.4 11.4 6.2 12 0Z";
const CHAMPAGNE = ["#c99a3e", "#e4c06c", "#b3842f"];

type Glint = { x: string; y: string; size: number; delay: number; duration?: number; opacity?: number };
const CARD_GLINTS: Glint[] = [
  { x: "82%", y: "10%", size: 22, delay: 0, duration: 3.2 },
  { x: "92%", y: "38%", size: 12, delay: 1.1 },
  { x: "68%", y: "6%", size: 10, delay: 1.9 },
  { x: "58%", y: "24%", size: 7, delay: 2.6, opacity: 0.8 },
  { x: "88%", y: "64%", size: 9, delay: 0.6, opacity: 0.85 },
  { x: "74%", y: "44%", size: 6, delay: 3.0, opacity: 0.75 },
];

// Fine glitter dust: tiny gold specks scattered over the top-right of a card.
// Positions come from a fixed seed so they don't jump between renders.
const DUST = Array.from({ length: 26 }, (_, i) => {
  const r = (n: number) => ((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1;
  return { x: 42 + r(1) * 56 + "%", y: 2 + r(2) * 52 + "%", size: 1.5 + r(3) * 2, delay: r(4) * 4, duration: 2.4 + r(5) * 2.4, color: CHAMPAGNE[i % 3] };
});

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

export function GlitterDust() {
  const [still] = React.useState(reducedMotion);
  return (
    <div aria-hidden="true" data-glitter-dust="" className="pointer-events-none absolute inset-0">
      {DUST.map((d, i) => (
        <span key={i} className={cn("absolute rounded-full", !still && "glint")}
          style={{ left: d.x, top: d.y, width: d.size, height: d.size, background: d.color, boxShadow: `0 0 ${d.size * 2}px ${d.color}`, opacity: still ? 0.55 : undefined, ["--glint-d" as string]: d.delay + "s", ["--glint-t" as string]: d.duration + "s", ["--glint-o" as string]: 1 }} />
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
      <div className="sheen absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-[#f0d58c]/[0.4] to-transparent" />
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

const TOUCHABLE = 'button, a[href], [role="button"], [role="tab"], [role="menuitem"], [role="option"], [role="radio"], [role="checkbox"], summary';

// Touch ripple, ColorOS style: starts wherever the finger lands (empty space
// too) and follows the press. A quick tap leaves a tiny, faint ripple; holding
// grows it until release, then it fades with a pinch of gold dust. On buttons,
// rows and tabs it is clipped to the element's shape. Drawn in a fixed overlay
// that ignores pointer events, so it never shifts layout or blocks taps. Uses
// the Web Animations API; with reduced motion on it is a brief glow only.
export function installTouchWave() {
  if (typeof document === "undefined") return () => {};
  const MAX = 64, MIN = 14, GROW_MS = 900;
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const el = (e.target as Element | null)?.closest?.(TOUCHABLE) as HTMLElement | null;
    // Disabled controls give no feedback (and browsers don't report their release).
    if (el?.matches(":disabled, [aria-disabled='true'], [data-disabled]")) return;
    const rect = el?.getBoundingClientRect();
    if (el && (!rect?.width || !rect.height)) return;
    const still = reducedMotion();
    const start = performance.now();

    // Clipped to the pressed element, or a free square around the finger.
    const box = rect ?? new DOMRect(e.clientX - MAX, e.clientY - MAX, MAX * 2, MAX * 2);
    const x = e.clientX - box.left, y = e.clientY - box.top;
    const layer = document.createElement("div");
    layer.setAttribute("aria-hidden", "true");
    layer.style.cssText = `position:fixed;left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px;${el ? `border-radius:${getComputedStyle(el).borderRadius};overflow:hidden;` : ""}pointer-events:none;z-index:2147483000;isolation:isolate`;
    const circle = (r: number, css: string) => {
      const c = document.createElement("div");
      c.style.cssText = `position:absolute;left:${x - r}px;top:${y - r}px;width:${r * 2}px;height:${r * 2}px;border-radius:999px;${css}`;
      layer.appendChild(c);
      return c;
    };
    // Slightly stronger on dark ink buttons so the gold still reads.
    const bg = el ? getComputedStyle(el).backgroundColor.match(/[\d.]+/g)?.map(Number) ?? [] : [];
    const dark = bg.length >= 3 && (bg[3] ?? 1) > 0.5 && bg[0] * 0.299 + bg[1] * 0.587 + bg[2] * 0.114 < 90;
    const a = dark ? [34, 14, 55] : [28, 11, 45];
    const glow = circle(MAX, `background:radial-gradient(circle, rgb(226 186 98 / ${a[0]}%) 0%, rgb(226 186 98 / ${a[1]}%) 55%, transparent 72%)`);
    const ring = still ? null : circle(MAX, `border:1px solid rgb(214 168 72 / ${a[2]}%)`);
    document.body.appendChild(layer);

    const ease = "cubic-bezier(0.22, 0.8, 0.3, 1)";
    const from = MIN / MAX;
    const grow = still
      ? [glow.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, fill: "forwards" })]
      : [glow, ring!].map(c => c.animate([{ transform: `scale(${from})`, opacity: 1 }, { transform: "scale(1)", opacity: 1 }], { duration: GROW_MS, easing: ease, fill: "forwards" }));

    // Follow a pressed element while it moves (press scale, page slide-in).
    let alive = true;
    const follow = () => {
      if (!alive) return;
      if (el?.isConnected) {
        const r = el.getBoundingClientRect();
        layer.style.left = r.left + "px"; layer.style.top = r.top + "px";
        layer.style.width = r.width + "px"; layer.style.height = r.height + "px";
      }
      requestAnimationFrame(follow);
    };
    if (el) requestAnimationFrame(follow);

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      window.removeEventListener("pointermove", onMove, true);
      const t = Math.min(1, (performance.now() - start) / GROW_MS);
      // How far the ripple got, on the same ease-out curve, used for the fade.
      const scale = from + (1 - from) * (1 - Math.pow(1 - t, 3));
      grow.forEach(g => g.pause());
      let done = 560;
      if (still) {
        glow.animate([{ opacity: 1 }, { opacity: 1, offset: 0.4 }, { opacity: 0 }], { duration: 500, fill: "forwards" });
      } else {
        // A tap is over in well under 100ms, so on release the ripple still
        // blooms to a small visible size and holds briefly before fading.
        const end = Math.min(1, Math.max(scale * 1.3, 0.55));
        const fade = (c: HTMLElement, o: number) => c.animate([{ transform: `scale(${scale})`, opacity: o }, { opacity: o, offset: 0.45 }, { transform: `scale(${end})`, opacity: 0 }], { duration: 520, easing: ease, fill: "forwards" });
        grow.forEach(g => g.cancel());
        fade(glow, 1); fade(ring!, 1);
        // A pinch of gold dust: more and further the longer the press.
        const specks = 2 + Math.round(t * 4), R = MAX * end;
        for (let i = 0; i < specks; i++) {
          const angle = (i / specks) * Math.PI * 2 + Math.random() * 1.2;
          const dist = R * (0.5 + Math.random() * 0.5);
          const size = 1.5 + Math.random();
          const sp = circle(size / 2, `background:${CHAMPAGNE[i % 3]}`);
          const duration = 380 + Math.random() * 140;
          sp.animate([
            { transform: "translate(0,0)", opacity: 0 },
            { opacity: 0.85, offset: 0.3 },
            { transform: `translate(${Math.cos(angle) * dist}px, ${Math.sin(angle) * dist}px)`, opacity: 0 },
          ], { duration, easing: ease, fill: "forwards" });
          done = Math.max(done, duration);
        }
      }
      window.setTimeout(() => { alive = false; layer.remove(); }, done + 60);
    };
    const onUp = (ev: PointerEvent) => { if (ev.pointerId === e.pointerId) release(); };
    // A scroll or drag isn't a press: let the ripple go.
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId === e.pointerId && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) > 10) release();
    };
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
    window.addEventListener("pointermove", onMove, { capture: true, passive: true });
    // Safety net if the release is never seen (e.g. the page lost focus).
    window.setTimeout(release, 5000);
  };
  document.addEventListener("pointerdown", onDown, { passive: true, capture: true });
  return () => document.removeEventListener("pointerdown", onDown, { capture: true });
}
