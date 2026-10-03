"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  IconDashboard,
  IconSend,
  IconMail,
  IconInbox,
  IconUsers,
  IconBriefcase,
  IconSettings,
  IconGlobe,
  IconBot,
  IconPhone,
  IconSparkle,
  IconStore,
} from "@/components/icons";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: IconDashboard },
  { href: "/business", label: "Your business", icon: IconSparkle },
  { href: "/campaigns", label: "Campaigns", icon: IconSend },
  { href: "/leads", label: "Leads", icon: IconUsers },
  { href: "/unibox", label: "Unibox", icon: IconInbox },
  { href: "/phone", label: "Calls & SMS", icon: IconPhone },
  { href: "/agents", label: "Agents", icon: IconBot },
  { href: "/crm", label: "CRM", icon: IconBriefcase },
  { href: "/visitors", label: "Visitors", icon: IconGlobe },
  { href: "/accounts", label: "Email Accounts", icon: IconMail },
  { href: "/marketplace", label: "Domains", icon: IconStore },
  { href: "/settings", label: "Settings", icon: IconSettings },
];

export default function SidebarNav() {
  const pathname = usePathname();
  return (
    <nav className="flex-1 space-y-1 p-3">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(href + "/");
        return (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              active
                ? "bg-indigo-50 text-indigo-700"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            }`}
          >
            <Icon className={`h-[18px] w-[18px] ${active ? "text-indigo-600" : "text-slate-400"}`} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
