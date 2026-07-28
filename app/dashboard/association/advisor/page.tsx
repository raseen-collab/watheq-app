import AdvisorPage from "@/components/AdvisorPage";

export const dynamic = "force-dynamic";

/** المستشار داخل لوحة جمعيات الملاك — يبقى المستخدم في سياق لوحته */
export default function AssociationAdvisor() {
  return <AdvisorPage scope="hoa" />;
}
