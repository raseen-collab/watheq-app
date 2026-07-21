export const sar = (n: number | null | undefined) => (Number(n) || 0).toLocaleString("en-US");

export function daysLeft(iso?: string | null): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - new Date(new Date().toDateString()).getTime()) / 86400000);
}

export function waNumber(phone?: string | null): string {
  const p = (phone || "").replace(/\D/g, "");
  if (!p) return "";
  if (p.startsWith("966")) return p;
  if (p.startsWith("0")) return "966" + p.slice(1);
  if (p.length === 9) return "966" + p;
  return p;
}

export function waLink(phone: string | undefined | null, text: string) {
  return `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(text)}`;
}

export const today = () => new Date().toISOString().slice(0, 10);

export const WATHEQ_WA = "966596300591";
