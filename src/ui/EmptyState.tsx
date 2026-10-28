import type { LucideIcon } from 'lucide-react';

interface Props { icon: LucideIcon; title: string; description?: string; compact?: boolean }
export function EmptyState({ icon: Icon, title, description, compact = false }: Props) {
  return <div className={`ui-empty-state${compact ? ' is-compact' : ''}`}>
    <span aria-hidden="true"><Icon size={compact ? 18 : 22} strokeWidth={1.6} /></span>
    <div>{compact ? <h4>{title}</h4> : <h3>{title}</h3>}{description && <p>{description}</p>}</div>
  </div>;
}
