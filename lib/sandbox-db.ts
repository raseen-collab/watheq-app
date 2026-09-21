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
  /** أرشيف المستأجرين السابقين (schema-v45) — اختياري في التجربة */
  past_tenancies?: Row[];
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
      /* إعادة التأجير وديون السابقين (schema-v45) — نسخ مبسّطة تُبقي التجربة
         متسقة: كانت الدالة المجهولة تُرجع «نجاحًا» صامتًا فيعود القديم عند التحديث */
      if (fn === "watheq_relet_unit") {
        const t = store.tenants.find((x) => x.id === args.p_tenant);
        if (!t) return { data: null, error: { message: "الوحدة غير موجودة" } };
        if (String(t.status) !== "vacated") return { data: null, error: { message: "سجّل إخلاء المستأجر الحالي أولًا" } };
        if (!String(args.p_new?.name || "").trim()) return { data: null, error: { message: "اسم المستأجر الجديد مطلوب" } };
        const debt = Math.max(0, r2(Number(args.p_debt) || 0));
        const arch = { id: `sb_past_${Math.random().toString(36).slice(2, 10)}`, property_id: t.property_id, unit_row_id: t.id,
          unit: t.unit, name: t.name || "مستأجر سابق", phone: t.phone ?? null, national_id: t.national_id ?? null,
          debt_amount: debt, debt_paid: 0, debt_status: debt > 0 ? "open" : "settled", debt_note: null,
          archived_at: new Date().toISOString(), legacy: false };
        (store.past_tenancies ||= []).unshift(arch);
        let moved = 0;
        for (const x of store.payments) if (x.tenant_id === t.id) {
          x.past_tenancy_id = arch.id; x.payer_name = x.payer_name || t.name; x.unit_label = x.unit_label || t.unit; x.tenant_id = null; moved++;
        }
        const keep = ["name","phone","national_id","rent_amount","contract_start","payment_frequency","contract_periods","contract_end",
          "billing_anchor_day","contract_no","calendar","vat_mode","first_due","unit_type","rooms","baths","acs","elec_account",
          "water_account","meter_elec_in","meter_water_in","deposit_amount","unit"];
        for (const k of keep) if (k in (args.p_new || {})) (t as any)[k] = args.p_new[k];
        Object.assign(t, { status: "active", paid_periods: 0, partial_amount: 0, carried_debt: 0, carried_debt_note: null,
          move_out_date: null, notice_date: null, deposit_deductions: 0, meter_elec_out: null, meter_water_out: null,
          debt_status: null, debt_note: null, debt_since: null });
        return { data: { past_tenancy_id: arch.id, payments_moved: moved, debt }, error: null };
      }
      if (fn === "watheq_record_past_payment") {
        const a = (store.past_tenancies || []).find((x) => x.id === args.p_past);
        if (!a) return { data: null, error: { message: "السجل غير موجود" } };
        const amt = r2(Number(args.p_amount) || 0), left = r2(a.debt_amount - a.debt_paid);
        if (amt <= 0) return { data: null, error: { message: "المبلغ يجب أن يكون أكبر من صفر" } };
        if (amt > left + 0.005) return { data: null, error: { message: `المبلغ أكبر من المتبقي (${left})` } };
        store.payments = [{ id: `sb_pay_${Math.random().toString(36).slice(2, 10)}`, tenant_id: null, past_tenancy_id: a.id,
          property_id: a.property_id, paid_on: args.p_paid_on || new Date().toISOString().slice(0, 10), amount: amt,
          method: "transfer", note: "سداد دين مستأجر سابق", periods_covered: 0, payer_name: a.name, unit_label: a.unit,
          applies_to: "past_debt", created_at: new Date().toISOString() }, ...store.payments];
        a.debt_paid = r2(a.debt_paid + amt); if (a.debt_paid >= a.debt_amount - 0.005) a.debt_status = "settled";
        const prop = store.properties.find((p) => p.id === a.property_id);
        if (prop) prop.collected = (Number(prop.collected) || 0) + amt;
        return { data: { debt_paid: a.debt_paid, remaining: r2(a.debt_amount - a.debt_paid) }, error: null };
      }
      if (fn === "watheq_set_past_debt") {
        const a = (store.past_tenancies || []).find((x) => x.id === args.p_past);
        if (!a) return { data: null, error: { message: "السجل غير موجود" } };
        if (args.p_status === "settled" && a.debt_paid < a.debt_amount - 0.005)
          return { data: null, error: { message: `بقي ${r2(a.debt_amount - a.debt_paid)} — سجّل سداده، أو اختر «شُطب»` } };
        a.debt_status = args.p_status; if (args.p_note) a.debt_note = args.p_note;
        return { data: { status: a.debt_status }, error: null };
      }
      if (fn === "watheq_record_carried_payment") {
        const t = store.tenants.find((x) => x.id === args.p_tenant);
        const amt = r2(Number(args.p_amount) || 0);
        if (!t) return { data: null, error: { message: "الوحدة غير موجودة" } };
        if (amt <= 0 || amt > (Number(t.carried_debt) || 0) + 0.005) return { data: null, error: { message: "المبلغ أكبر من الدين المرحَّل" } };
        store.payments = [{ id: `sb_pay_${Math.random().toString(36).slice(2, 10)}`, tenant_id: t.id, property_id: t.property_id,
          paid_on: args.p_paid_on || new Date().toISOString().slice(0, 10), amount: amt, method: "transfer",
          note: "سداد دين مرحَّل", periods_covered: 0, payer_name: t.name, unit_label: t.unit, applies_to: "carried",
          created_at: new Date().toISOString() }, ...store.payments];
        t.carried_debt = r2((Number(t.carried_debt) || 0) - amt);
        const prop = store.properties.find((p) => p.id === t.property_id);
        if (prop) prop.collected = (Number(prop.collected) || 0) + amt;
        return { data: { remaining: t.carried_debt }, error: null };
      }
      if (fn === "watheq_write_off_carried") {
        const t = store.tenants.find((x) => x.id === args.p_tenant);
        if (!t) return { data: null, error: { message: "الوحدة غير موجودة" } };
        if (!String(args.p_note || "").trim()) return { data: null, error: { message: "اذكر سبب الشطب" } };
        const w = Number(t.carried_debt) || 0; t.carried_debt = 0;
        return { data: { written_off: w }, error: null };
      }
      if (fn === "next_invoice_no") return { data: Math.floor(1000 + Math.random() * 9000), error: null };
      if (fn === "watheq_my_office") return { data: [{ office: "demo-user", role: "owner", perms: {} }], error: null };
      return { data: null, error: null };
    },
  } as any;
}
