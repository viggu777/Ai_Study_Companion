import Link from "next/link";
import type { ReactNode } from "react";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/* ---------- Buttons ---------- */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

const buttonStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-sky-600 text-white shadow-card hover:bg-sky-700 focus-visible:outline-sky-600 disabled:bg-sky-600/60",
  secondary:
    "bg-white text-stone-700 border border-stone-300 shadow-card hover:bg-stone-50 hover:border-stone-400 focus-visible:outline-sky-600",
  ghost: "text-stone-600 hover:bg-stone-200/60 hover:text-stone-900",
  danger: "bg-white text-red-700 border border-red-200 shadow-card hover:bg-red-50",
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
  lg: "px-5 py-2.5 text-sm",
};

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({ variant = "primary", size = "md", className, ...rest }: ButtonProps) {
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-60",
        buttonStyles[variant],
        buttonSizes[size],
        className
      )}
      {...rest}
    />
  );
}

export function LinkButton({
  href,
  variant = "primary",
  size = "md",
  className,
  children,
}: {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors",
        buttonStyles[variant],
        buttonSizes[size],
        className
      )}
    >
      {children}
    </Link>
  );
}

/* ---------- Card ---------- */

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cx("rounded-xl border border-stone-200 bg-white shadow-card", className)}>
      {children}
    </div>
  );
}

/* ---------- Badge ---------- */

type BadgeTone = "neutral" | "success" | "warning" | "danger" | "accent";

const badgeTones: Record<BadgeTone, string> = {
  neutral: "bg-stone-100 text-stone-700",
  success: "bg-sky-600 text-white",
  warning: "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-600/25",
  danger: "bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20",
  accent: "bg-stone-100 text-stone-800 ring-1 ring-inset ring-sky-600/10",
};

export function Badge({ tone = "neutral", className, children }: { tone?: BadgeTone; className?: string; children: ReactNode }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
        badgeTones[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

/* ---------- Page header ---------- */

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-stone-500">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ---------- Stats ---------- */

export function Stat({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-stone-500">{label}</p>
          <p className="tnum mt-1 text-[28px] font-semibold leading-none tracking-tight text-stone-900">
            {value}
          </p>
          {sub && <p className="mt-1.5 text-xs text-stone-400">{sub}</p>}
        </div>
        {icon && (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-700">
            {icon}
          </span>
        )}
      </div>
    </Card>
  );
}

/* ---------- Forms ---------- */

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-stone-700">{label}</label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-stone-400">{hint}</p>}
    </div>
  );
}

export const inputClass =
  "block w-full rounded-lg border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 shadow-card placeholder:text-stone-400 focus:border-sky-600 focus:ring-sky-600 disabled:bg-stone-50 disabled:text-stone-400";

export function Alert({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {children}
    </div>
  );
}

/* ---------- Empty state ---------- */

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <Card className="px-6 py-12 text-center">
      {icon && (
        <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-sky-50 text-sky-700">
          {icon}
        </div>
      )}
      <h3 className="text-sm font-semibold text-stone-900">{title}</h3>
      {description && <p className="mx-auto mt-1 max-w-sm text-sm text-stone-500">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </Card>
  );
}

/* ---------- Spinner ---------- */

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx("h-4 w-4 animate-spin", className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z"
      />
    </svg>
  );
}
