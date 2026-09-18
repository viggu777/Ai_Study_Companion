/** Stroke icon set (24px, 1.8px stroke) — no emoji, no external icon dependency. */

interface IconProps {
  className?: string;
}

function Base({ className = "h-5 w-5", children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

export function DashboardIcon({ className }: IconProps) {
  return (
    <Base className={className}>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </Base>
  );
}

export function FolderIcon({ className }: IconProps) {
  return (
    <Base className={className}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </Base>
  );
}

export function PlusIcon({ className }: IconProps) {
  return (
    <Base className={className}>
      <path d="M12 5v14M5 12h14" />
    </Base>
  );
}

export function BookIcon({ className }: IconProps) {
  return (
    <Base className={className}>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4a2 2 0 0 0-2-2H6.5A2.5 2.5 0 0 0 4 4.5v15z" />
      <path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" />
    </Base>
  );
}

export function ChatIcon({ className }: IconProps) {
  return (
    <Base className={className}>
      <path d="M21 12a8 8 0 0 1-8 8H4l2-3a8 8 0 1 1 15-5z" />
    </Base>
  );
}

export function QuizIcon({ className }: IconProps) {
  return (
    <Base className={className}>
      <path d="M9 11l3 3 8-8" />
      <path d="M21 12v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h11" />
    </Base>
  );
}

export function ChartIcon({ className }: IconProps) {
  return (
    <Base className={className}>
      <path d="M3 3v18h18" />
      <path d="M7 15l4-5 3 3 5-7" />
    </Base>
  );
}

export function SparkIcon({ className }: IconProps) {
  return (
    <Base className={className}>
      <path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4L12 3z" />
      <path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z" />
    </Base>
  );
}

export function UsersIcon({ className }: IconProps) {
  return (
    <Base className={className}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 5a3.5 3.5 0 0 1 0 7M17.5 14.5a6.5 6.5 0 0 1 4 5.5" />
    </Base>
  );
}

export function ActivityIcon({ className }: IconProps) {
  return (
    <Base className={className}>
      <path d="M3 12h4l3 8 4-16 3 8h4" />
    </Base>
  );
}

export function CpuIcon({ className }: IconProps) {
  return (
    <Base className={className}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
    </Base>
  );
}

export function FlaskIcon({ className }: IconProps) {
  return (
    <Base className={className}>
      <path d="M9 3h6M10 3v6L4.5 19a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L14 9V3" />
      <path d="M7.5 15h9" />
    </Base>
  );
}

export function JobsIcon({ className }: IconProps) {
  return (
    <Base className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" />
    </Base>
  );
}

export function UploadIcon({ className }: IconProps) {
  return (
    <Base className={className}>
      <path d="M12 16V4M6 10l6-6 6 6" />
      <path d="M4 20h16" />
    </Base>
  );
}

export function LogoutIcon({ className }: IconProps) {
  return (
    <Base className={className}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5M21 12H9" />
    </Base>
  );
}

export function MenuIcon({ className }: IconProps) {
  return (
    <Base className={className}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Base>
  );
}

export function SearchIcon({ className }: IconProps) {
  return (
    <Base className={className}>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </Base>
  );
}

export function BellIcon({ className }: IconProps) {
  return (
    <Base className={className}>
      <path d="M18 9a6 6 0 1 0-12 0c0 6-2.5 7-2.5 7h17S18 15 18 9z" />
      <path d="M10 20a2.2 2.2 0 0 0 4 0" />
    </Base>
  );
}

export function CloseIcon({ className }: IconProps) {
  return (
    <Base className={className}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Base>
  );
}

export function ArrowRightIcon({ className }: IconProps) {
  return (
    <Base className={className}>
      <path d="M4 12h16M13 5l7 7-7 7" />
    </Base>
  );
}

export function ChevronUpIcon({ className }: IconProps) {
  return (
    <Base className={className}>
      <path d="M6 14l6-6 6 6" />
    </Base>
  );
}

export function TargetIcon({ className }: IconProps) {
  return (
    <Base className={className}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" />
    </Base>
  );
}

export function TrendUpIcon({ className }: IconProps) {
  return (
    <Base className={className}>
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M15 7h6v6" />
    </Base>
  );
}

export function CardsIcon({ className }: IconProps) {
  return (
    <Base className={className}>
      <rect x="3" y="6" width="13" height="14" rx="2" />
      <path d="M8 6V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-1" />
      <path d="M7 11h5M7 15h3" />
    </Base>
  );
}

export function ConceptsIcon({ className }: IconProps) {
  return (
    <Base className={className}>
      <circle cx="12" cy="5" r="2.5" />
      <circle cx="5" cy="19" r="2.5" />
      <circle cx="19" cy="19" r="2.5" />
      <path d="M12 7.5v4M10.5 12l-3.5 4.5M13.5 12l3.5 4.5" />
    </Base>
  );
}
