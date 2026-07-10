import React from "react";

export type EventIconKind = "like" | "gift" | "follow" | "share" | "visit";

type Props = {
  kind: EventIconKind;
  className?: string;
};

const EventTypeIcon: React.FC<Props> = ({ kind, className = "" }) => (
  <svg className={`event-type-icon event-type-icon--${kind} ${className}`.trim()} viewBox="0 0 48 48" aria-hidden="true">
    {kind === "like" ? (
      <path d="M24 41C19 36 8 29 6 20 4 11 15 5 24 14 33 5 44 11 42 20c-2 9-13 16-18 21Z" fill="currentColor" />
    ) : kind === "gift" ? (
      <>
        <path d="M6 20h36v22H6z" fill="currentColor" />
        <path d="M4 14h40v9H4z" fill="#ffd14b" />
        <path d="M21 14h7v28h-7z" fill="#ffcf3e" />
        <path d="M23 14C15 13 10 9 12 5c2-4 9-1 12 7 3-8 10-11 12-7 2 4-3 8-13 9Z" fill="none" stroke="#ffe789" strokeWidth="4" strokeLinecap="round" />
      </>
    ) : kind === "follow" ? (
      <path d="M20 6h8v14h14v8H28v14h-8V28H6v-8h14Z" fill="currentColor" />
    ) : kind === "share" ? (
      <>
        <path d="M19 29 14 34a7 7 0 0 1-10-10l8-8a7 7 0 0 1 10 0" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
        <path d="m29 19 5-5a7 7 0 1 1 10 10l-8 8a7 7 0 0 1-10 0" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
        <path d="m17 31 14-14" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
      </>
    ) : (
      <>
        <circle cx="28" cy="8" r="5" fill="currentColor" />
        <path d="m22 16 8-2 7 8-4 4-5-5-2 8 7 11-5 3-7-10-5 10-6-3 8-14-4-2-5 6-5-3 8-10c2-2 6-2 10-1Z" fill="currentColor" />
      </>
    )}
  </svg>
);

export default EventTypeIcon;
