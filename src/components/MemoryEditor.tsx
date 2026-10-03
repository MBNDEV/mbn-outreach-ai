import {
  addMemoryAction,
  toggleMemoryAction,
  deleteMemoryAction,
} from "@/lib/actions/agents";

// Server-rendered: every control is a form post, so this needs no client bundle.

export default function MemoryEditor({
  kinds,
  records,
  canManage,
}: {
  kinds: Array<{ id: string; label: string; hint: string }>;
  records: Array<{ id: string; kind: string; content: string; enabled: boolean }>;
  canManage: boolean;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold">Memory</h2>
      <p className="mt-1 text-sm text-slate-600">
        What every agent in this workspace knows. Campaign copy is written from these lines, so
        keep them short and true.
      </p>

      <div className="mt-4 space-y-4">
        {kinds.map((kind) => {
          const mine = records.filter((record) => record.kind === kind.id);
          return (
            <div key={kind.id}>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {kind.label}
              </p>
              {mine.length === 0 ? (
                <p className="mt-1 text-sm text-slate-400">{kind.hint}</p>
              ) : (
                <ul className="mt-1.5 space-y-1.5">
                  {mine.map((record) => (
                    <li key={record.id} className="flex items-start gap-2">
                      <p
                        className={`flex-1 text-sm ${
                          record.enabled ? "text-slate-700" : "text-slate-400 line-through"
                        }`}
                      >
                        {record.content}
                      </p>
                      {canManage && (
                        <span className="flex shrink-0 items-center gap-1.5">
                          <form action={toggleMemoryAction}>
                            <input type="hidden" name="id" value={record.id} />
                            <button className="text-xs text-slate-500 underline hover:text-slate-800">
                              {record.enabled ? "Disable" : "Enable"}
                            </button>
                          </form>
                          <form action={deleteMemoryAction}>
                            <input type="hidden" name="id" value={record.id} />
                            <button className="text-xs text-red-600 underline hover:text-red-800">
                              Delete
                            </button>
                          </form>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {canManage && (
        <form action={addMemoryAction} className="mt-5 flex items-end gap-2 border-t border-slate-100 pt-4">
          <label className="text-sm">
            <span className="font-medium">Add</span>
            <select
              name="kind"
              className="mt-1 block rounded-xl border border-slate-300 px-2 py-1.5 text-sm"
            >
              {kinds.map((kind) => (
                <option key={kind.id} value={kind.id}>
                  {kind.label}
                </option>
              ))}
            </select>
          </label>
          <input
            name="content"
            placeholder="We build websites and run SEO for home-service businesses."
            className="flex-1 rounded-xl border border-slate-300 px-3 py-1.5 text-sm"
          />
          <button className="rounded-xl border border-slate-300 px-3 py-1.5 text-sm font-medium transition hover:bg-slate-50">
            Add
          </button>
        </form>
      )}
    </section>
  );
}
