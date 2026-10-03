"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { FormState } from "@/lib/actions/auth";

interface Field {
  name: string;
  label: string;
  type?: string;
  placeholder?: string;
}

export default function AuthForm({
  title,
  action,
  fields,
  submitLabel,
  footer,
  hidden,
}: {
  title: string;
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  fields: Field[];
  submitLabel: string;
  footer: { text: string; linkText: string; href: string };
  hidden?: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState(action, {} as FormState);

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="mb-6 text-xl font-semibold">{title}</h1>
        <form action={formAction} className="space-y-4">
          {hidden &&
            Object.entries(hidden).map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
          {fields.map((f) => (
            <label key={f.name} className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">{f.label}</span>
              <input
                name={f.name}
                type={f.type ?? "text"}
                placeholder={f.placeholder}
                required
                className="w-full rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500"
              />
            </label>
          ))}
          {state.error && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
          )}
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-md bg-indigo-600 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:opacity-50"
          >
            {pending ? "Please wait…" : submitLabel}
          </button>
        </form>
        <p className="mt-4 text-sm text-slate-600">
          {footer.text}{" "}
          <Link href={footer.href} className="font-medium text-slate-900 underline">
            {footer.linkText}
          </Link>
        </p>
      </div>
    </main>
  );
}
