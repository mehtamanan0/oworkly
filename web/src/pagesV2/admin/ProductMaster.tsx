import { AppShell } from "../../shell/AppShell";
import { PageHeader } from "../../shell/PageHeader";
import { EmptyState } from "../../components/figma/EmptyState";

export function ProductMaster() {
  return (
    <AppShell breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: "Product Master" }]}>
      <PageHeader title="Product Master" description="Hierarchical product tree and sub-product configuration" />
      <EmptyState title="Configuration for this area lands in the next phase" description="Product Master is on the roadmap — not part of this vertical slice." />
    </AppShell>
  );
}
