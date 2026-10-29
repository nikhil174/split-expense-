import {
  BedDouble, Car, Coffee, Fuel, Gift, HeartPulse, Home, Plane, Popcorn, Receipt, ShoppingBag, ShoppingCart, Ticket, Train, Utensils, Wine, Zap,
  type LucideIcon,
} from "lucide-react";

// A small, friendly icon tile for each expense, guessed from its description.
export type Category = { icon: LucideIcon; bg: string; fg: string };

const RULES: [RegExp, Category][] = [
  [/\b(dinner|lunch|breakfast|food|biryani|rice|pizza|burger|meal|restaurant|snack|dosa|thali|swiggy|zomato|chicken|paneer|noodle)/i, { icon: Utensils, bg: "#fff1e6", fg: "#f2711c" }],
  [/\b(coffee|tea|chai|cafe|starbucks|juice)/i, { icon: Coffee, bg: "#f6eee8", fg: "#9a5b34" }],
  [/\b(drink|drinks|alcohol|beer|wine|bar|pub|whisky|vodka|rum)/i, { icon: Wine, bg: "#f6ebff", fg: "#9b4de0" }],
  [/\b(auto|cab|taxi|uber|ola|rapido|car|bike|parking|toll)/i, { icon: Car, bg: "#e8f3ff", fg: "#2f7cf6" }],
  [/\b(fuel|petrol|diesel|gas)/i, { icon: Fuel, bg: "#fff4e0", fg: "#e09100" }],
  [/\b(train|metro|bus|irctc)/i, { icon: Train, bg: "#e8f3ff", fg: "#2f7cf6" }],
  [/\b(flight|plane|air|airport|indigo)/i, { icon: Plane, bg: "#e6f7fb", fg: "#0aa2c0" }],
  [/\b(hotel|stay|room|airbnb|oyo|hostel|resort)/i, { icon: BedDouble, bg: "#e9f8f1", fg: "#00a870" }],
  [/\b(rent|house|flat|maid|electricity|wifi|internet)/i, { icon: Home, bg: "#eef3f1", fg: "#4a6b60" }],
  [/\b(grocer|vegetable|fruit|milk|bigbasket|blinkit|zepto|dmart|supermarket)/i, { icon: ShoppingCart, bg: "#eaf8ec", fg: "#2f9e44" }],
  [/\b(shopping|clothes|amazon|flipkart|myntra|mall)/i, { icon: ShoppingBag, bg: "#ffeef3", fg: "#e64980" }],
  [/\b(ticket|tickets|entry|museum|park|event|concert)/i, { icon: Ticket, bg: "#fff0f0", fg: "#f0454c" }],
  [/\b(movie|cinema|netflix|popcorn)/i, { icon: Popcorn, bg: "#fff3e6", fg: "#e8590c" }],
  [/\b(gift|birthday|party|cake)/i, { icon: Gift, bg: "#fdeefa", fg: "#c2255c" }],
  [/\b(medicine|doctor|hospital|pharmacy)/i, { icon: HeartPulse, bg: "#ffeef0", fg: "#e03131" }],
  [/\b(recharge|bill|power)/i, { icon: Zap, bg: "#fffbe6", fg: "#d4a106" }],
];
const FALLBACK: Category = { icon: Receipt, bg: "#eef4f2", fg: "#46655b" };

export function categoryOf(description: string): Category {
  return RULES.find(([re]) => re.test(description))?.[1] ?? FALLBACK;
}
