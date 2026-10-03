import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { providerConfigured } from "@/lib/oauth";

export default async function NewAccountPage() {
  await requireRole("admin");
  const googleReady = providerConfigured("google");
  const microsoftReady = providerConfigured("microsoft");

  const options = [
    {
      title: "Gmail / Google Workspace",
      desc: googleReady
        ? "OAuth connection with send + IMAP scopes."
        : "Set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in .env to enable.",
      href: googleReady ? "/api/oauth/google/start" : null,
      cta: "Connect with Google",
    },
    {
      title: "Microsoft 365 / Outlook",
      desc: microsoftReady
        ? "OAuth connection with SMTP.Send + IMAP scopes."
        : "Set MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET in .env to enable.",
      href: microsoftReady ? "/api/oauth/microsoft/start" : null,
      cta: "Connect with Microsoft",
    },
    {
      title: "Any provider (IMAP / SMTP)",
      desc: "Connect a single mailbox with SMTP and IMAP credentials.",
      href: "/accounts/new/smtp",
      cta: "Enter credentials",
    },
    {
      title: "Bulk import from CSV",
      desc: "Upload many IMAP/SMTP accounts at once from a spreadsheet.",
      href: "/accounts/new/csv",
      cta: "Upload CSV",
    },
  ];

  return (
    <div className="max-w-3xl">
      <h1 className="mb-6 text-2xl font-semibold">Add sending accounts</h1>
      <div className="grid grid-cols-2 gap-4">
        {options.map((o) => (
          <div key={o.title} className="flex flex-col rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="font-medium">{o.title}</h2>
            <p className="mt-1 flex-1 text-sm text-slate-600">{o.desc}</p>
            {o.href ? (
              <Link
                href={o.href}
                className="mt-4 inline-block w-fit rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-500"
              >
                {o.cta}
              </Link>
            ) : (
              <span className="mt-4 inline-block w-fit cursor-not-allowed rounded-md bg-slate-200 px-4 py-2 text-sm font-medium text-slate-500">
                Not configured
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
