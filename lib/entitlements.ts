/**
 * ============================================================
 * الباقات والصلاحيات — مصدر الحقيقة في التطبيق (مرجعه صفحة الأسعار)
 * ============================================================
 * يطابق حرفيًّا الحارس في القاعدة (schema-v67: watheq_product_state +
 * watheq_entitlement_guard). القاعدة تمنع، وهذا الملف يُظهر ويُنبّه قبل
 * أن يملأ المستخدم نموذجًا سيُرفض.
 *
 *   أملاك   basic «باقة المالك»  عقار واحد · مستشار 5
 *           («نظرة المحفظة» لا تُحجب: بعقار واحد لا محفظة أصلًا، وفيها «التزامات
 *            المكتب» التي تشملها الباقتان في جدول المقارنة)
 *           full  «باقة المكتب»  بلا حد · نظرة المحفظة · مستشار 30
 *           (pro القديمة للأملاك تُعامل كالمكتب — لا نسحب من أحد شيئًا)
 *   جمعيات  basic «الأساسية»    جمعية واحدة حتى 20 وحدة · مستشار 5
 *           pro   «الاحترافية»   جمعية واحدة بلا حد وحدات · سجل العمارة · تصدير CSV · مستشار 15
 *           full  «الشاملة»      جمعيات بلا حد · مستشار 30
 *   التجربة = كل المزايا بلا حدود (مستشار 10).
 *   بعد انتهاء الاشتراك + 5 أيام سماح (أو انتهاء التجربة بلا اشتراك):
 *     قراءة وتصدير فقط · علامة «نسخة تجريبية» على المستندات · مستشار 3.
 *
 * الحساب المزدوج: plan = باقة الأملاك، hoa_plan = باقة الجمعيات.
 * وحساب الجمعيات وحدها: باقته في plan كما كانت دائمًا.
 */
import { subState, type SubProfile, type SubState } from "./subscription";

export type Product = "property" | "hoa";
export type EntState = "paid" | "grace" | "trial" | "expired";

export type EntProfile = SubProfile & {
  account_type?: string | null;
  hoa_plan?: string | null;
};

/** باقة المنتج كما يقرؤها الحارس في القاعدة */
export function productPlan(p: EntProfile | null | undefined, product: Product): string | null {
  const raw = product === "hoa" && p?.account_type === "both" ? p?.hoa_plan : p?.plan;
  const v = String(raw || "").toLowerCase();
  return v || null;
}

/** ملف اشتراك المنتج — يُمرَّر إلى subState وissuerMarks */
export function productProfile(p: EntProfile | null | undefined, product: Product): SubProfile {
  return { plan: productPlan(p, product), trial_ends_at: p?.trial_ends_at ?? null, subscribed_until: p?.subscribed_until ?? null };
}

export function productSub(p: EntProfile | null | undefined, product: Product): SubState {
  return subState(productProfile(p, product));
}

export function productState(p: EntProfile | null | undefined, product: Product): EntState {
  const s = productSub(p, product);
  return s.grace ? "grace" : s.paid ? "paid" : s.trial ? "trial" : "expired";
}

export type Limits = {
  product: Product;
  state: EntState;
  /** الباقة الفعلية للمنتج (null في التجربة أو بلا باقة) */
  plan: string | null;
  /** قراءة وتصدير فقط */
  readOnly: boolean;
  /** Infinity = بلا حد */
  maxProperties: number;
  maxAssociations: number;
  maxUnitsPerAssociation: number;
  /** تبويب «سجل العمارة» الكامل */
  buildingLog: boolean;
  /** تنزيل الملاك CSV */
  ownersExport: boolean;
  advisorDaily: number;
};

const ALL: Omit<Limits, "product" | "state" | "plan" | "readOnly" | "advisorDaily"> = {
  maxProperties: Infinity, maxAssociations: Infinity, maxUnitsPerAssociation: Infinity,
  buildingLog: true, ownersExport: true,
};

export const ADVISOR_DAILY = { trial: 10, expired: 3, basic: 5, pro: 15, full: 30 } as const;

export function limitsFor(p: EntProfile | null | undefined, product: Product): Limits {
  const state = productState(p, product);
  const plan = productPlan(p, product);
  const base = { product, state, plan, readOnly: state === "expired" };

  if (state === "trial") return { ...base, ...ALL, advisorDaily: ADVISOR_DAILY.trial };
  if (state === "expired") return { ...base, ...ALL, advisorDaily: ADVISOR_DAILY.expired };

  // مدفوع أو ضمن السماح: حدود الباقة
  if (product === "property") {
    if (plan === "basic") {
      return { ...base, ...ALL, maxProperties: 1, advisorDaily: ADVISOR_DAILY.basic };
    }
    return { ...base, ...ALL, advisorDaily: ADVISOR_DAILY.full };   // full (والـpro القديمة)
  }
  if (plan === "basic") {
    return { ...base, ...ALL, maxAssociations: 1, maxUnitsPerAssociation: 20, buildingLog: false, ownersExport: false,
      advisorDaily: ADVISOR_DAILY.basic };
  }
  if (plan === "pro") return { ...base, ...ALL, maxAssociations: 1, advisorDaily: ADVISOR_DAILY.pro };
  return { ...base, ...ALL, advisorDaily: ADVISOR_DAILY.full };
}

/** المنتجات التي يملكها نوع الحساب */
export function productsOf(accountType?: string | null): Product[] {
  if (accountType === "both") return ["property", "hoa"];
  if (accountType === "hoa_manager") return ["hoa"];
  return ["property"];
}

/** حساب الجمعيات وحدها: منتجه «hoa» وباقته في plan */
export function primaryProduct(accountType?: string | null): Product {
  return accountType === "hoa_manager" ? "hoa" : "property";
}

/** حصة المستشار اليومية: أعلى حصة بين منتجات الحساب (المستشار واحد للحساب) */
export function advisorDailyFor(p: EntProfile | null | undefined): number {
  return Math.max(...productsOf(p?.account_type).map((pr) => limitsFor(p, pr).advisorDaily));
}

/** هل انتهى كل ما يملكه الحساب؟ (يوقف ملخّص تليجرام) */
export function allExpired(p: EntProfile | null | undefined): boolean {
  return productsOf(p?.account_type).every((pr) => productState(p, pr) === "expired");
}

/** رسائل الترقية — نفس نصوص الحارس في القاعدة */
export const LIMIT_MSG = {
  readOnly: "انتهى الاشتراك أو التجربة — الحساب الآن للقراءة والتصدير فقط. فعّل الاشتراك لتعود الإضافة والتعديل.",
  properties: "باقة المالك تشمل عقارًا واحدًا — لإضافة عقارات أكثر انتقل إلى باقة المكتب.",
  associations: "باقتك تشمل جمعية واحدة — لإدارة أكثر من جمعية انتقل إلى الباقة الشاملة.",
  units: "الباقة الأساسية تشمل حتى 20 وحدة — للوحدات بلا حد انتقل إلى الباقة الاحترافية.",
};

/** ما يعبر من الخادم إلى المكوّنات (Infinity لا يمرّ عبر JSON — نستعمل null) */
export type LimitsWire = Omit<Limits, "maxProperties" | "maxAssociations" | "maxUnitsPerAssociation"> & {
  maxProperties: number | null; maxAssociations: number | null; maxUnitsPerAssociation: number | null;
};
const fin = (n: number) => (Number.isFinite(n) ? n : null);
export function toWire(l: Limits): LimitsWire {
  return { ...l, maxProperties: fin(l.maxProperties), maxAssociations: fin(l.maxAssociations), maxUnitsPerAssociation: fin(l.maxUnitsPerAssociation) };
}
/** هل بلغ العدد الحد؟ (null = بلا حد) */
export const atLimit = (count: number, max: number | null | undefined) => max != null && count >= max;
