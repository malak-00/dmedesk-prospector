// What does this supplier bill Medicare for? Turns the rows of CMS's "DME, Devices & Supplies - by Supplier
// and Service" file (one row per HCPCS code) into a few product categories and our three verticals.
// Pure, so it is tested without the network. The payment per row is an estimate: services x average payment.

export const MIX_YEAR = 2024; // the dataset the Worker reads (see services/productMix.js)

// HCPCS code ranges for the verticals the team sells. Ranges are inclusive. These are a reasonable first
// mapping from the public HCPCS code set, worth a quick check by someone who sells the products.
const inRange = (code, prefix, from, to) => {
  const m = /^([A-Z])(\d{4})$/.exec(code);
  return Boolean(m) && m[1] === prefix && Number(m[2]) >= from && Number(m[2]) <= to;
};

export const VERTICALS = [
  { key: "ort", label: "Orthotics & prosthetics", match: (c) => /^L\d{4}$/.test(c) },
  {
    key: "cgm",
    label: "CGM",
    match: (c) => ["A4238", "A4239", "E2102", "E2103", "A9276", "A9277", "A9278", "K0553", "K0554"].includes(c),
  },
  {
    key: "lymph",
    label: "Lymphedema",
    match: (c) => inRange(c, "E", 650, 652) || inRange(c, "E", 655, 673) || inRange(c, "A", 6530, 6549),
  },
];

export function verticalOf(hcpcs) {
  const code = String(hcpcs || "").trim().toUpperCase();
  const v = VERTICALS.find((x) => x.match(code));
  return v ? v.key : null;
}

const num = (v) => {
  const n = parseFloat(String(v == null ? "" : v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};

// "DME-Orthotic Devices" -> "Orthotic Devices"; "Treatment-Injections and Infusions (nononcologic)" -> keeps the part after the dash
const categoryName = (desc) => String(desc || "Other").replace(/^[A-Za-z]+-/, "").trim() || "Other";

export const MAX_CATEGORIES = 5;
export const MAX_PRODUCTS = 3;

export function buildProductMix(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return null;

  const byCategory = new Map();
  const byVertical = new Map();
  const byProduct = new Map();
  let total = 0;
  let rentalPay = 0;
  for (const row of list) {
    const pay = num(row.Tot_Suplr_Srvcs) * num(row.Avg_Suplr_Mdcr_Pymt_Amt);
    total += pay;
    if (String(row.Suplr_Rentl_Ind || "").toUpperCase() === "Y") rentalPay += pay;
    const cat = categoryName(row.RBCS_Desc);
    byCategory.set(cat, (byCategory.get(cat) || 0) + pay);
    const v = verticalOf(row.HCPCS_Cd);
    if (v) byVertical.set(v, (byVertical.get(v) || 0) + pay);
    const code = String(row.HCPCS_Cd || "");
    const prev = byProduct.get(code) || { code, name: String(row.HCPCS_Desc || ""), payment: 0 };
    prev.payment += pay;
    byProduct.set(code, prev);
  }

  const share = (pay) => (total > 0 ? pay / total : 0);
  const categories = [...byCategory.entries()]
    .map(([name, payment]) => ({ name, payment: Math.round(payment), share: share(payment) }))
    .sort((a, b) => b.payment - a.payment);
  const top = categories.slice(0, MAX_CATEGORIES);
  const rest = categories.slice(MAX_CATEGORIES);
  if (rest.length) {
    const payment = rest.reduce((s, c) => s + c.payment, 0);
    top.push({ name: "Other", payment, share: share(payment) });
  }

  const verticals = VERTICALS.map((v) => ({ key: v.key, label: v.label, payment: Math.round(byVertical.get(v.key) || 0), share: share(byVertical.get(v.key) || 0) }))
    .filter((v) => v.payment > 0)
    .sort((a, b) => b.payment - a.payment);

  const products = [...byProduct.values()]
    .sort((a, b) => b.payment - a.payment)
    .slice(0, MAX_PRODUCTS)
    .map((p) => ({ code: p.code, name: p.name, payment: Math.round(p.payment) }));

  // Urban or rural, as CMS classes the supplier's location (RUCA); the same on every row of one supplier.
  const first = list[0] || {};
  const area = first.Suplr_Prvdr_RUCA_Cat ? { category: String(first.Suplr_Prvdr_RUCA_Cat), detail: String(first.Suplr_Prvdr_RUCA_Desc || "") } : null;

  return {
    year: MIX_YEAR, total: Math.round(total), codes: list.length, categories: top, verticals, products,
    rentalShare: share(rentalPay), area,
  };
}

// Medicare payments by year, from the by-supplier files. yearRows: [{ year, payment, patients }] in any order;
// a year with no row (the supplier was not billing Medicare) is simply absent.
export const NEW_BELOW = 5000; // an earlier year under this is "just starting", not a base to measure growth from

export function buildTrend(yearRows, newestYear = MIX_YEAR) {
  const points = (yearRows || [])
    .filter((r) => r && Number.isFinite(Number(r.year)) && Number(r.payment) > 0)
    .map((r) => ({ year: Number(r.year), payment: Math.round(Number(r.payment)), patients: Number.isFinite(Number(r.patients)) ? Number(r.patients) : null }))
    .sort((a, b) => a.year - b.year);
  if (points.length === 0) return null;
  const latest = points[points.length - 1];
  // Billed before but not in the newest file: stopped (or fell below CMS's reporting threshold).
  if (latest.year < newestYear) return { points, direction: "stopped", change: null, latestYear: latest.year };
  if (points.length === 1) return { points, direction: "single", change: null, latestYear: latest.year };
  const prev = points[points.length - 2];
  const change = (latest.payment - prev.payment) / prev.payment;
  let direction = "flat";
  if (prev.payment < NEW_BELOW && latest.payment >= prev.payment * 2) direction = "new";
  else if (change >= 0.1) direction = "up";
  else if (change <= -0.2) direction = "down";
  return { points, direction, change, latestYear: latest.year, previousYear: prev.year };
}
