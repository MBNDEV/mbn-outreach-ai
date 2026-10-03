import { requireRole } from "@/lib/auth";
import CsvImportForm from "@/components/CsvImportForm";

export default async function CsvImportPage() {
  await requireRole("admin");
  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Bulk import accounts from CSV</h1>
      <CsvImportForm />
    </div>
  );
}
