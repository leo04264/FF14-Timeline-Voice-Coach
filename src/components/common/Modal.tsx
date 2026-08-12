import { useEffect, type ReactNode } from 'react';

interface ModalProps {
  title: string;
  onClose(): void;
  children: ReactNode;
  footer?: ReactNode;
  /** Esc closes by default; the player disables it so Esc stays WIPE. */
  closeOnEscape?: boolean;
}

export function Modal({ title, onClose, children, footer, closeOnEscape = true }: ModalProps) {
  useEffect(() => {
    if (!closeOnEscape) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, closeOnEscape]);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <h2>{title}</h2>
        {children}
        {footer ? (
          <div className="row modal-footer">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
