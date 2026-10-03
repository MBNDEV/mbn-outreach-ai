import { requireWorkspace } from "@/lib/auth";
import { logoutAction } from "@/lib/actions/auth";
import { planLimits } from "@/lib/plans";
import SidebarNav from "@/components/SidebarNav";
import WorkspaceSwitcher from "@/components/WorkspaceSwitcher";
import CopilotPanel from "@/components/CopilotPanel";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { user, workspace, workspaces } = await requireWorkspace();

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 flex w-60 flex-col border-r border-slate-200 bg-white">
        <WorkspaceSwitcher
          active={{ id: workspace.id, name: workspace.name }}
          workspaces={workspaces}
          planLabel={planLimits(workspace.plan).label}
          brand={{
            name: workspace.brandName,
            color: workspace.brandColor,
            logoUrl: workspace.brandLogoUrl,
          }}
        />
        <SidebarNav />
        <div className="border-t border-slate-100 p-4">
          {workspace.brandName && (
            <p className="mb-2 truncate text-xs font-medium text-slate-600">
              {workspace.brandName}
            </p>
          )}
          <p className="mb-2 truncate text-xs text-slate-500">{user.email}</p>
          <form action={logoutAction}>
            <button className="text-sm font-medium text-slate-600 transition-colors hover:text-slate-900">
              Log out
            </button>
          </form>
        </div>
      </aside>
      <main className="ml-60 flex-1 px-8 py-7">{children}</main>
      <CopilotPanel />
    </div>
  );
}
