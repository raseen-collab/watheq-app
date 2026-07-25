// lib/contract-ui.ts — مساعدات عرض حالة العقد في الواجهة
export type ContractStateRow = {
  tenant_id: string;
  state: "active" | "due_soon" | "arrears" | "expiring" | "litigation";
  state_label: string;
  state_color: string;
  owed: number;
  days_to_end: number | null;
  next_due: string | null;
};

/** يحوّل مصفوفة الحالات إلى خريطة { tenant_id: state } */
export function statesByTenant(rows: ContractStateRow[]): Record<string, ContractStateRow> {
  const map: Record<string, ContractStateRow> = {};
  (rows || []).forEach((r) => (map[r.tenant_id] = r));
  return map;
}

/** شارة جاهزة (نص + لون) لأي مستأجر */
export function stateBadge(row?: ContractStateRow) {
  if (!row) return { label: "—", color: "#9CA3AF" };
  return { label: row.state_label, color: row.state_color };
}
