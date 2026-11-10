"use client";

import * as Dialog from "@radix-ui/react-dialog";
import * as Switch from "@radix-ui/react-switch";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { ButtonHTMLAttributes, InputHTMLAttributes, LabelHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        default: "bg-[var(--accent)] text-[var(--accent-ink)] hover:brightness-110",
        outline: "border border-[var(--line)] bg-transparent hover:bg-white/5",
        ghost: "hover:bg-white/5",
        danger: "bg-[var(--down)] text-white hover:brightness-110",
      },
      size: {
        default: "h-9 px-3",
        sm: "h-8 px-2.5 text-xs",
        lg: "h-10 px-4",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export function Button({
  className,
  variant,
  size,
  asChild,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "h-9 w-full rounded-md border border-[var(--line)] bg-[#0e141c] px-3 text-sm outline-none focus:border-[var(--accent)]",
        props.className,
      )}
    />
  );
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        "h-9 w-full rounded-md border border-[var(--line)] bg-[#0e141c] px-2 text-sm outline-none focus:border-[var(--accent)]",
        props.className,
      )}
    />
  );
}

export function Label(props: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label {...props} className={cn("mb-1 block text-xs uppercase tracking-wide text-[var(--muted)]", props.className)} />;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "up" | "down" | "accent" | "warn" }) {
  const tones = {
    neutral: "border-[var(--line)] text-[var(--muted)]",
    up: "border-[var(--up)]/40 text-[var(--up)]",
    down: "border-[var(--down)]/40 text-[var(--down)]",
    accent: "border-[var(--accent)]/50 text-[var(--accent)]",
    warn: "border-amber-400/40 text-amber-200",
  };
  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-wide", tones[tone])}>{children}</span>;
}

export function Toggle({ checked, onCheckedChange, label }: { checked: boolean; onCheckedChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span>{label}</span>
      <Switch.Root checked={checked} onCheckedChange={onCheckedChange} className="h-5 w-9 rounded-full bg-[#2a3544] data-[state=checked]:bg-[var(--accent)]">
        <Switch.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-white transition data-[state=checked]:translate-x-4" />
      </Switch.Root>
    </label>
  );
}

export function Modal({ open, onOpenChange, title, children }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; children: ReactNode }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/70" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(460px,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5">
          <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>
          <div className="mt-3">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
