import { FiAlertCircle } from 'react-icons/fi';

export function FormError({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-red-700 text-sm mb-3">
      <FiAlertCircle className="shrink-0 mt-0.5" size={14} />
      <span>{message}</span>
    </div>
  );
}
