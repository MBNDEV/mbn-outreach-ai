// Reply-pipeline labels shared by Unibox, analytics, and (later) the CRM.
export const THREAD_LABELS = [
  { id: "lead", label: "Lead" },
  { id: "interested", label: "Interested" },
  { id: "meeting_booked", label: "Meeting booked" },
  { id: "meeting_completed", label: "Meeting completed" },
  { id: "won", label: "Won" },
  { id: "out_of_office", label: "Out of office" },
  { id: "wrong_person", label: "Wrong person" },
  { id: "not_interested", label: "Not interested" },
  { id: "lost", label: "Lost" },
] as const;

export const POSITIVE_LABELS = ["interested", "meeting_booked", "meeting_completed", "won"];
