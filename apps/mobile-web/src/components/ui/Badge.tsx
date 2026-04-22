import clsx from 'clsx';

interface BadgeProps {
  label: string;
  variant?: 'blue' | 'green' | 'red' | 'yellow' | 'gray' | 'purple';
  className?: string;
}

const variantClasses: Record<NonNullable<BadgeProps['variant']>, string> = {
  blue: 'bg-blue-900/60 text-blue-300 border-blue-700/50',
  green: 'bg-green-900/60 text-green-300 border-green-700/50',
  red: 'bg-red-900/60 text-red-300 border-red-700/50',
  yellow: 'bg-yellow-900/60 text-yellow-300 border-yellow-700/50',
  gray: 'bg-gray-800 text-gray-300 border-gray-700',
  purple: 'bg-purple-900/60 text-purple-300 border-purple-700/50',
};

export function Badge({ label, variant = 'gray', className }: BadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        variantClasses[variant],
        className,
      )}
    >
      {label}
    </span>
  );
}
