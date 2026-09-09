import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "success" | "danger" | "ghost";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-fig-blue text-white hover:bg-blue-600 disabled:bg-blue-300",
  secondary: "border border-fig-border bg-white text-fig-text hover:bg-fig-bg",
  success: "bg-fig-green text-white hover:bg-green-700 disabled:bg-green-300",
  danger: "border border-fig-border bg-white text-fig-red hover:bg-red-50",
  ghost: "text-fig-muted hover:text-fig-text",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
    />
  );
}
