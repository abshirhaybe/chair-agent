/**
 * The CHAIRHAUS catalog. A small, curated set of premium seating used to render
 * the storefront. Images are hotlinked from Unsplash's CDN (hand-picked, clean
 * studio shots); `ProductImage` falls back to a branded placeholder if one fails.
 */

export type Category = "Task" | "Executive" | "Lounge" | "Accent" | "Stool";

export type Product = {
  id: string;
  name: string;
  brand: string;
  /** Price in whole USD. */
  price: number;
  /** Average rating, 0–5. */
  rating: number;
  reviews: number;
  category: Category;
  image: string;
  blurb: string;
  /** Short spec highlights shown as pills on the card. */
  tags: string[];
  /** Hex swatches for the colorway dots. */
  colors: string[];
};

/** Build an Unsplash CDN URL for a given photo id at a target width. */
const img = (photoId: string, w = 800) =>
  `https://images.unsplash.com/photo-${photoId}?auto=format&fit=crop&w=${w}&q=80`;

/** A wide lifestyle shot used behind the hero. */
export const HERO_IMAGE = img("1524758631624-e2822e304c36", 1400);

export const CATEGORIES: Category[] = ["Task", "Executive", "Lounge", "Accent", "Stool"];

export const PRODUCTS: Product[] = [
  {
    id: "aria-swivel-lounge",
    name: "Aria Swivel Lounge",
    brand: "Muse",
    price: 890,
    rating: 4.8,
    reviews: 214,
    category: "Lounge",
    image: img("1580480055273-228ff5388ef8"),
    blurb:
      "A wool-blend shell on a sculpted oak star base. Quiet 360° swivel for breakout spaces and reading corners.",
    tags: ["360° swivel", "Solid oak base", "Wool-blend seat"],
    colors: ["#cdbfa6", "#3a3a3a", "#3f5e4e"],
  },
  {
    id: "nord-task",
    name: "Nord Task",
    brand: "Form & Co",
    price: 420,
    rating: 4.7,
    reviews: 338,
    category: "Task",
    image: img("1592078615290-033ee584e267"),
    blurb:
      "A contoured polymer shell with a cushioned seat pad and warm beech legs. Light enough to move, built to last.",
    tags: ["Contoured shell", "Beech legs", "Stackable"],
    colors: ["#1c1c1c", "#e8e8e8", "#6b8aa6"],
  },
  {
    id: "regent-executive",
    name: "Regent Executive",
    brand: "Atelier",
    price: 1180,
    rating: 4.9,
    reviews: 126,
    category: "Executive",
    image: img("1598300042247-d088f8ab3a91"),
    blurb:
      "High-back support wrapped in heathered upholstery over a solid ash frame. The chair for long, focused days.",
    tags: ["High back", "Memory foam", "Solid ash frame"],
    colors: ["#9a9a96", "#2e2e2e", "#7a5c3e"],
  },
  {
    id: "margaux-accent",
    name: "Margaux Accent",
    brand: "Maison",
    price: 640,
    rating: 4.6,
    reviews: 92,
    category: "Accent",
    image: img("1567538096630-e0c55bd6374c"),
    blurb:
      "Hand-tufted velvet with a gently curved back and turned hardwood legs. A statement piece for any corner.",
    tags: ["Hand-tufted", "Velvet", "Hardwood legs"],
    colors: ["#efeae3", "#2f4858", "#7d2e3a"],
  },
  {
    id: "halo-shell-lounge",
    name: "Halo Shell Lounge",
    brand: "Muse",
    price: 760,
    rating: 4.8,
    reviews: 158,
    category: "Lounge",
    image: img("1519947486511-46149fa0a254"),
    blurb:
      "A molded plywood shell cradling a leather seat on a cantilever base. Mid-century lines, modern comfort.",
    tags: ["Molded plywood", "Leather seat", "Cantilever base"],
    colors: ["#f3f1ec", "#caa472", "#222222"],
  },
  {
    id: "atelier-drafting-stool",
    name: "Atelier Drafting Stool",
    brand: "Form & Co",
    price: 290,
    rating: 4.5,
    reviews: 74,
    category: "Stool",
    image: img("1503602642458-232111445657"),
    blurb:
      "Solid maple with a height-adjustable column and integrated footrest. Made for standing desks and studios.",
    tags: ["Height adjust", "Footrest", "Solid maple"],
    colors: ["#d9cbb3", "#3a3a3a"],
  },
];

/** Format a whole-dollar amount as USD. */
export const formatPrice = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
