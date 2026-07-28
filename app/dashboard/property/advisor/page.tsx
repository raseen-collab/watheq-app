import AdvisorPage from "@/components/AdvisorPage";

export const dynamic = "force-dynamic";

/** المستشار داخل لوحة إدارة الأملاك — يبقى المستخدم في سياق لوحته */
export default function PropertyAdvisor() {
  return <AdvisorPage scope="property" />;
}
