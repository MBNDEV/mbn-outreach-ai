"use client";

import { useRef, useState, useTransition } from "react";
import {
  saveSequenceAction,
  generateSequenceAiAction,
  type SequencePayload,
} from "@/lib/actions/campaigns";
import { renderTemplate, VARIABLES, type LeadVars } from "@/lib/template";
import { IconPlus, IconTrash } from "@/components/icons";

interface VariantDraft {
  label: string;
  subject: string;
  body: string;
  enabled: boolean;
}
interface StepDraft {
  waitDays: number;
  channel?: string;
  variants: VariantDraft[];
}

const SAMPLE_VARS: LeadVars = {
  email: "jane@acme.com",
  first_name: "Jane",
  last_name: "Doe",
  company: "Acme Inc",
  title: "Owner",
};

const inputCls =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm outline-none transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100";

export default function SequenceEditor({
  campaignId,
  initialSteps,
  aiEnabled,
}: {
  campaignId: string;
  initialSteps: StepDraft[];
  aiEnabled: boolean;
}) {
  const [steps, setSteps] = useState<StepDraft[]>(
    initialSteps.length > 0
      ? initialSteps
      : [{ waitDays: 0, channel: "email", variants: [{ label: "A", subject: "", body: "", enabled: true }] }]
  );
  const [activeStep, setActiveStep] = useState(0);
  const [activeVariant, setActiveVariant] = useState(0);
  const [preview, setPreview] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, startSave] = useTransition();
  const [aiOpen, setAiOpen] = useState(false);
  const [generating, startGenerate] = useTransition();
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const aiFormRef = useRef<HTMLFormElement>(null);

  function generateWithAi() {
    const form = aiFormRef.current;
    if (!form) return;
    const data = new FormData(form);
    setError(null);
    startGenerate(async () => {
      const result = await generateSequenceAiAction(campaignId, {
        business: String(data.get("business") ?? ""),
        offer: String(data.get("offer") ?? ""),
        audience: String(data.get("audience") ?? ""),
        stepCount: Number(data.get("stepCount") ?? 3) || 3,
      });
      if (result.error) setError(result.error);
      else if (result.steps) {
        setSteps(result.steps);
        setActiveStep(0);
        setActiveVariant(0);
        setDirty(true);
        setSaved(false);
        setAiOpen(false);
      }
    });
  }

  const step = steps[activeStep];
  const variant = step?.variants[Math.min(activeVariant, (step?.variants.length ?? 1) - 1)];

  function update(mutate: (draft: StepDraft[]) => void) {
    setSteps((prev) => {
      const next = structuredClone(prev);
      mutate(next);
      return next;
    });
    setDirty(true);
    setSaved(false);
  }

  function insertToken(token: string) {
    const el = bodyRef.current;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const value = el.value.slice(0, start) + token + el.value.slice(end);
    update((d) => {
      d[activeStep].variants[activeVariant].body = value;
    });
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + token.length;
    });
  }

  function save() {
    setError(null);
    startSave(async () => {
      const payload: SequencePayload = { steps };
      const result = await saveSequenceAction(campaignId, payload);
      if (result.error) setError(result.error);
      else {
        setDirty(false);
        setSaved(true);
      }
    });
  }

  return (
    <div className="grid grid-cols-[280px_1fr] gap-6">
      {/* Step list */}
      <div className="space-y-3">
        {steps.map((s, i) => (
          <div key={i}>
            {i > 0 && (
              <div className="mb-3 flex items-center gap-2 pl-3 text-xs text-slate-500">
                <span>Wait</span>
                <input
                  type="number"
                  min={0}
                  max={90}
                  value={s.waitDays}
                  onChange={(e) =>
                    update((d) => {
                      d[i].waitDays = Number(e.target.value);
                    })
                  }
                  className="w-14 rounded-md border border-slate-200 px-2 py-1 text-center text-xs shadow-sm"
                />
                <span>day{s.waitDays === 1 ? "" : "s"}, then</span>
                <select
                  value={s.channel ?? "email"}
                  onChange={(e) =>
                    update((d) => {
                      d[i].channel = e.target.value;
                    })
                  }
                  className="rounded-lg border border-slate-200 px-1.5 py-0.5 text-xs"
                  aria-label="Channel for this step"
                >
                  <option value="email">email</option>
                  <option value="sms">SMS</option>
                </select>
              </div>
            )}
            <button
              onClick={() => {
                setActiveStep(i);
                setActiveVariant(0);
              }}
              className={`group w-full rounded-xl border p-4 text-left transition-colors ${
                i === activeStep
                  ? "border-indigo-300 bg-indigo-50/50 ring-2 ring-indigo-100"
                  : "border-slate-200 bg-white hover:border-slate-300"
              }`}
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-900">Step {i + 1}</p>
                {steps.length > 1 && (
                  <span
                    role="button"
                    aria-label={`Delete step ${i + 1}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      update((d) => {
                        d.splice(i, 1);
                      });
                      setActiveStep((cur) => Math.max(0, cur > i ? cur - 1 : Math.min(cur, steps.length - 2)));
                    }}
                    className="rounded p-1 text-slate-300 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
                  >
                    <IconTrash className="h-4 w-4" />
                  </span>
                )}
              </div>
              <p className="mt-1 truncate text-xs text-slate-500">
                {s.variants[0]?.subject || "No subject yet"}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                {s.variants.length} variant{s.variants.length === 1 ? "" : "s"}
              </p>
            </button>
          </div>
        ))}
        <button
          onClick={() => {
            update((d) => {
              d.push({
                waitDays: 2,
                channel: "email",
                variants: [{ label: "A", subject: "", body: "", enabled: true }],
              });
            });
            setActiveStep(steps.length);
            setActiveVariant(0);
          }}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 py-3 text-sm font-medium text-slate-500 transition-colors hover:border-indigo-300 hover:text-indigo-600"
        >
          <IconPlus className="h-4 w-4" /> Add step
        </button>
      </div>

      {/* Editor pane */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <div className="flex items-center gap-1">
            {step?.variants.map((v, vi) => (
              <button
                key={vi}
                onClick={() => setActiveVariant(vi)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  vi === activeVariant
                    ? "bg-indigo-600 text-white"
                    : "text-slate-500 hover:bg-slate-100"
                }`}
              >
                {v.label}
              </button>
            ))}
            {(step?.variants.length ?? 0) < 5 && (
              <button
                onClick={() =>
                  update((d) => {
                    const list = d[activeStep].variants;
                    list.push({
                      label: String.fromCharCode(65 + list.length),
                      subject: "",
                      body: "",
                      enabled: true,
                    });
                  })
                }
                aria-label="Add variant"
                className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
              >
                <IconPlus className="h-4 w-4" />
              </button>
            )}
            {(step?.variants.length ?? 0) > 1 && (
              <button
                onClick={() => {
                  update((d) => {
                    d[activeStep].variants.splice(activeVariant, 1);
                    d[activeStep].variants.forEach((v, vi) => {
                      v.label = String.fromCharCode(65 + vi);
                    });
                  });
                  setActiveVariant(0);
                }}
                aria-label="Remove variant"
                className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-red-500"
              >
                <IconTrash className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            {aiEnabled && (
              <button
                onClick={() => setAiOpen((o) => !o)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  aiOpen ? "bg-indigo-50 text-indigo-700" : "text-indigo-600 hover:bg-indigo-50"
                }`}
              >
                ✦ Generate with AI
              </button>
            )}
            <button
              onClick={() => setPreview((p) => !p)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                preview ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-100"
              }`}
            >
              Preview
            </button>
            <button
              onClick={save}
              disabled={saving || !dirty}
              className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:opacity-40"
            >
              {saving ? "Saving…" : saved ? "Saved" : "Save"}
            </button>
          </div>
        </div>

        {aiOpen && (
          <form
            ref={aiFormRef}
            onSubmit={(e) => {
              e.preventDefault();
              generateWithAi();
            }}
            className="space-y-3 border-b border-indigo-100 bg-indigo-50/40 p-5"
          >
            <p className="text-sm font-medium text-indigo-900">
              Describe the pitch — the AI drafts the whole sequence (replaces current steps).
            </p>
            <div className="grid grid-cols-2 gap-3">
              <input name="business" required placeholder="Your business (e.g. web dev & SEO agency)" className={inputCls} />
              <input name="offer" required placeholder="Offer to pitch (e.g. website redesign + SEO)" className={inputCls} />
              <input name="audience" required placeholder="Audience (e.g. US SMB owners)" className={inputCls} />
              <select name="stepCount" defaultValue="3" className={inputCls}>
                {[2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n} steps
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              disabled={generating}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:opacity-50"
            >
              {generating ? "Generating…" : "Generate sequence"}
            </button>
          </form>
        )}

        {variant && !preview && (
          <div className="space-y-4 p-5">
            <input
              value={variant.subject}
              onChange={(e) =>
                update((d) => {
                  d[activeStep].variants[activeVariant].subject = e.target.value;
                })
              }
              placeholder={
                activeStep === 0 ? "Subject line" : "Subject (empty = “Following up”)"
              }
              className={inputCls}
            />
            <textarea
              ref={bodyRef}
              value={variant.body}
              onChange={(e) =>
                update((d) => {
                  d[activeStep].variants[activeVariant].body = e.target.value;
                })
              }
              placeholder={"Hi {{first_name}},\n\nWrite your email here…"}
              rows={14}
              className={`${inputCls} resize-y font-mono text-[13px] leading-relaxed`}
            />
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-slate-400">Insert:</span>
              {VARIABLES.map((v) => (
                <button
                  key={v.token}
                  onClick={() => insertToken(v.token)}
                  className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-200 hover:text-indigo-700"
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {variant && preview && (
          <div className="p-5">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-5">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                Preview with sample lead (Jane Doe, Acme Inc)
              </p>
              <p className="mb-3 border-b border-slate-200 pb-3 text-sm font-semibold">
                {renderTemplate(variant.subject, SAMPLE_VARS) || "(no subject)"}
              </p>
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                {renderTemplate(variant.body, SAMPLE_VARS) || "(empty body)"}
              </div>
            </div>
          </div>
        )}

        {error && (
          <p className="border-t border-red-100 bg-red-50 px-5 py-3 text-sm text-red-700">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
