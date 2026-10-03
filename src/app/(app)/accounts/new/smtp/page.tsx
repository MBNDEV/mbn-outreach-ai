import { requireRole } from "@/lib/auth";
import SmtpForm from "@/components/SmtpForm";

export default async function NewSmtpAccountPage() {
  await requireRole("admin");
  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Connect an IMAP/SMTP account</h1>
      <SmtpForm />
    </div>
  );
}
