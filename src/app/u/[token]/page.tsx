import { unsubscribeRecipient } from "@/lib/unsubscribe";
import { confirmUnsubscribeAction } from "@/lib/actions/unsubscribe";

// Unsubscribing happens on the POST below, never on render: link scanners and
// mail-client prefetchers GET this page, and a render-time write would opt
// people out of mail they never asked to leave.

export default async function UnsubscribePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const { token } = await params;
  const { done } = await searchParams;
  const recipient = await unsubscribeRecipient(token);
  const finished = done === "1" || recipient?.alreadyDone;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        {!recipient ? (
          <>
            <h1 className="text-lg font-semibold text-slate-900">Link not found</h1>
            <p className="mt-2 text-sm text-slate-600">
              This unsubscribe link is invalid or has expired.
            </p>
          </>
        ) : finished ? (
          <>
            <h1 className="text-lg font-semibold text-slate-900">You&rsquo;re unsubscribed</h1>
            <p className="mt-2 text-sm text-slate-600">
              {recipient.email} won&rsquo;t receive any more emails from this sender.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-lg font-semibold text-slate-900">Unsubscribe?</h1>
            <p className="mt-2 text-sm text-slate-600">
              Confirm and {recipient.email} will stop receiving emails from this sender.
            </p>
            <form action={confirmUnsubscribeAction} className="mt-6">
              <input type="hidden" name="token" value={token} />
              <button
                type="submit"
                className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
              >
                Unsubscribe me
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
