import type { ButtonHTMLAttributes, PropsWithChildren } from 'react';

type Variant = 'primary' | 'success' | 'secondary' | 'danger' | 'ghost' | 'outline';

export function Button({ children, className = '', variant = 'secondary', ...props }: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }>) {
  return (
    <button type="button" className={`btn btn-${variant} ${className}`.trim()} {...props}>
      {children}
    </button>
  );
}
