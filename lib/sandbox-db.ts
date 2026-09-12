// ============================================================
// وثيق — قاعدة وهمية للتجربة العامة
//
// صفحة التجربة تُفتح قبل التسجيل: لا جلسة ولا قاعدة ولا كتابة. ومع ذلك
// نريد اللوحة نفسها لا نسخة مبسّطة — فالزائر يجب أن يرى المنتج لا صورته.
//
// الحل: عميل يحاكي واجهة Supabase في الذاكرة. اللوحة تستدعيه كما تستدعي
// القاعدة، فيعمل زر تسجيل الدفعة والتراجع والملاحظات فعلًا — وتضيع النتيجة
// عند إعادة التحميل، وهذا هو المقصود.
//
// لا يكتب شيئًا ولا يقرأ شيئًا من الخادم: لا مسار تسرّب ولا عبء.
// ============================================================

type Row = Record<string, any>;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const r2 = (n: number) => Math.round(n * 100) / 100;

export type SandboxStore = {
  properties: Row[];
  tenants: Row[];
  payments: Row[];
  expenses: Row[];
  property_notes: Row[];
  invoices: Row[];
  office_messages: Row[];
};

/** منشئ استعلامات يحاكي سلسلة Supabase: select/eq/order/limit ثم await */
function table(store: SandboxStore, name: keyof SandboxStore) {
  let rows: Row[] = store[name] || [];
  let filtered = rows.slice();
  let pending: { op: "insert" | "update" | "delete"; payload?: any } | null = null;

  const api: any = {
    select() { return api; },
    eq(col: string, val: any) { filtered = filtered.filter((r) => String(r[col]) === String(val)); return api; },
    neq(col: string, val: any) { filtered = filtered.filter((r) => String(r[col]) !== String(val)); return api; },
    in(col: string, vals: any[]) { const s = vals.map(String); filtered = filtered.filter((r) => s.includes(String(r[col]))); return api; },
    gte(col: string, v: any) { filtered = filtered.filter((r) => String(r[col]) >= String(v)); return api; },
    lte(col: string, v: any) { filtered = filtered.filter((r) => String(r[col]) <= String(v)); return api; },
    is(col: string, v: any) { filtered = filtered.filter((r) => (v === null ? r[col] == null : r[col] === v)); return api; },
    not() { return api; }, or() { return api; }, ilike() { return api; },
    order(col: string, o?: { ascending?: boolean }) {
      const asc = o?.ascending !== false;
      filtered.sort((a, b) => String(a[col] ?? "").localeCompare(String(b[col] ?? "")) * (asc ? 1 : -1));
      return api;
    },
    limit(n: number) { filtered = filtered.slice(0, n); return api; },
    range() { return api; },

    insert(payload: any) { pending = { op: "insert", payload }; return api; },
    update(payload: any) { pending = { op: "update", payload }; return api; },
    delete() { pending = { op: "delete" }; return api; },

    single() { return api.then((r: any) => ({ data: r.data?.[0] ?? null, error: r.error })); },
    maybeSingle() { return api.single(); },

    then(resolve: (v: any) => any, reject?: (e: any) => any) {
      let data: Row[] = [];
      try {
        if (pending?.op === "insert") {
          const items = Array.isArray(pending.payload) ? pending.payload : [pending.payload];
          const added = items.map((x: Row) => ({ id: `sb_${name}_${Math.random().toString(36).slice(2, 10)}`, created_at: new Date().toISOString(), ...x }));
          store[name] = [...added, ...rows];
          data = clone(added);
        } else if (pending?.op === "update") {
          const ids = new Set(filtered.map((r) => r.id));
          store[name] = rows.map((r) => (ids.has(r.id) ? { ...r, ...pending!.payload } : r));
          data = clone(store[name].filter((r) => ids.has(r.id)));
        } else if (pending?.op === "delete") {
          const ids = new Set(filtered.map((r) => r.id));
          store[name] = rows.filter((r) => !ids.has(r.id));
          data = clone([...ids].map((id) => ({ id })));
        } else {
          data = clone(filtered);
        }
      } catch (e) { return Promise.resolve({ data: null, error: { message: String(e) } }).then(resolve, reject); }
      return Promise.resolve({ data, error: null, count: data.length }).then(resolve, reject);
    },
  };
  return api;
}

/**
 * عميل التجربة. يدعم ما تستدعيه اللوحة فعلًا:
 * الجداول السبعة، ودالتَي تسجيل الدفعة والتراجع، وترقيم الفواتير.
 */
export function sandboxClient(store: SandboxStore) {
  return {
    from: (name: string) => table(store, name as keyof SandboxStore),
    auth: { getUser: async () => ({ data: { user: { id: "demo-user" } } }) },
    rpc: async (fn: string, args: any = {}) => {
      if (fn === "watheq_record_payment") {
        const t = store.tenants.find((x) => x.id === args.p_tenant);
        if (!t) return { data: null, error: { message: "العقد غير موجود" } };
        const rent = Number(t.rent_amount) || 0;
        if (rent <= 0) return { data: null, error: { message: "قيمة الدفعة غير محدّدة" } };
        const pool = Math.max(0, Number(t.partial_amount) || 0) + Number(args.p_amount || 0);
        const completed = Math.floor(pool / rent);
        t.partial_amount = r2(pool - completed * rent);
        t.paid_periods = Math.max(0, (Number(t.paid_periods) || 0) + completed);
        store.payments = [{
          id: `sb_pay_${Math.random().toString(36).slice(2, 10)}`, tenant_id: t.id, property_id: t.property_id,
          paid_on: args.p_paid_on || new Date().toISOString().slice(0, 10), amount: args.p_amount,
          method: args.p_method || "transfer", note: args.p_note ?? null, reference: args.p_reference ?? null,
          periods_covered: completed, created_at: new Date().toISOString(),
        }, ...store.payments];
        const prop = store.properties.find((p) => p.id === t.property_id);
        if (prop) prop.collected = (Number(prop.collected) || 0) + Number(args.p_amount || 0);
        return { data: { paid_periods: t.paid_periods, partial_amount: t.partial_amount, completed }, error: null };
      }
      if (fn === "watheq_undo_payment") {
        const t = store.tenants.find((x) => x.id === args.p_tenant);
        if (!t || (Number(t.paid_periods) || 0) <= 0) return { data: null, error: { message: "لا دفعات للتراجع عنها" } };
        t.paid_periods = Number(t.paid_periods) - 1;
        return { data: { paid_periods: t.paid_periods, reversed: Number(t.rent_amount) || 0 }, error: null };
      }
      if (fn === "next_invoice_no") return { data: Math.floor(1000 + Math.random() * 9000), error: null };
      if (fn === "watheq_my_office") return { data: [{ office: "demo-user", role: "owner", perms: {} }], error: null };
      return { data: null, error: null };
    },
  } as any;
}
