// Minimal inline icon set (24px viewBox, stroke-based, lucide-style paths).

function Svg({ d, className }: { d: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? "h-5 w-5"}
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}

export const IconDashboard = (p: { className?: string }) => (
  <Svg {...p} d="M3 3h8v10H3zM13 3h8v6h-8zM13 13h8v8h-8zM3 17h8v4H3z" />
);
export const IconSend = (p: { className?: string }) => (
  <Svg {...p} d="M22 2 11 13M22 2l-7 20-4-9-9-4z" />
);
export const IconMail = (p: { className?: string }) => (
  <Svg {...p} d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm18 3-10 6L2 7" />
);
export const IconSettings = (p: { className?: string }) => (
  <Svg
    {...p}
    d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7.5 7.5 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7.5 7.5 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.06-.4.1-.8.1-1.2z"
  />
);
export const IconPlus = (p: { className?: string }) => <Svg {...p} d="M12 5v14M5 12h14" />;
export const IconTrash = (p: { className?: string }) => (
  <Svg {...p} d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
);
export const IconChevronLeft = (p: { className?: string }) => (
  <Svg {...p} d="m15 18-6-6 6-6" />
);
export const IconInbox = (p: { className?: string }) => (
  <Svg {...p} d="M22 12h-6l-2 3h-4l-2-3H2m20 0v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6m20 0-3.4-6.8A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.8 1.2L2 12" />
);
export const IconBriefcase = (p: { className?: string }) => (
  <Svg {...p} d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16M2 8h20a0 0 0 0 1 0 0v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a0 0 0 0 1 0 0z" />
);
export const IconUsers = (p: { className?: string }) => (
  <Svg {...p} d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm14 10v-2a4 4 0 0 0-3-3.85M16 3.15A4 4 0 0 1 16 11" />
);
export const IconGlobe = (p: { className?: string }) => (
  <Svg
    {...p}
    d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3.6 9h16.8M3.6 15h16.8M12 3c2.5 2.4 3.8 5.3 3.8 9S14.5 18.6 12 21c-2.5-2.4-3.8-5.3-3.8-9S9.5 5.4 12 3z"
  />
);
export const IconBot = (p: { className?: string }) => (
  <Svg
    {...p}
    d="M12 3v3M7 9h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2zM9.5 13v1.5M14.5 13v1.5M3 13v3M21 13v3"
  />
);
export const IconSparkle = (p: { className?: string }) => (
  <Svg {...p} d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3zM18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9L18 15z" />
);
export const IconPhone = (p: { className?: string }) => (
  <Svg
    {...p}
    d="M6.5 3h3l1.5 4-2 1.5a12 12 0 0 0 6.5 6.5L17 13l4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4 7.2 2 2 0 0 1 6 5z"
  />
);
export const IconStore = (p: { className?: string }) => (
  <Svg
    {...p}
    d="M4 9h16l-1 11H5L4 9zm0 0 1.5-5h13L20 9M9 13v4M15 13v4"
  />
);
