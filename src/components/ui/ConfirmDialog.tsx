import { useEffect } from "react";

type ConfirmVariant = "destructive" | "warning" | "default";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmVariant;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const confirmButtonCls: Record<ConfirmVariant, string> = {
  destructive:
    "rounded-full bg-clay-soft px-5 py-2 text-sm font-semibold text-clay transition hover:brightness-95 disabled:opacity-60",
  warning:
    "rounded-full bg-amber-soft px-5 py-2 text-sm font-semibold text-amber-ink transition hover:brightness-95 disabled:opacity-60",
  default:
    "rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-110 disabled:opacity-60",
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Go Back",
  variant = "destructive",
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onCancel();
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [open, loading, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-foreground/40 p-4 backdrop-blur-sm"
      onClick={loading ? undefined : onCancel}
      role="presentation"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-description"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-3xl bg-card shadow-2xl"
      >
        <div className="border-b border-border/70 bg-linen px-6 py-5">
          <h2 id="confirm-dialog-title" className="font-display text-xl font-semibold text-foreground">
            {title}
          </h2>
          <p id="confirm-dialog-description" className="mt-2 text-sm text-muted-foreground">
            {description}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/70 bg-linen/60 px-6 py-4">
          <button
            type="button"
            disabled={loading}
            onClick={onCancel}
            className="rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-secondary disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={onConfirm}
            className={confirmButtonCls[variant]}
          >
            {loading ? "Please wait..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
