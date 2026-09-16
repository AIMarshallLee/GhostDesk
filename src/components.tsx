import { useEffect, useRef, type ReactNode } from 'react';
import { ArrowUpRight, X, LoaderCircle, Check, ChevronRight, Inbox } from 'lucide-react';
import type { Scenario, TaskStatus } from '../shared/types';

export const scenarios: Record<Scenario, string> = { service: '电商客服', community: '社群运营', sales: '私域销售', recruitment: '招聘沟通', content: '内容运营' };
export const statuses: Record<TaskStatus, string> = { draft: '待起草', review: '待审核', approved: '已审核', completed: '已交接', archived: '已归档' };
export function Logo({ small = false }: { small?: boolean }) {
  return <span className={`brand ${small ? 'small' : ''}`}><span className="brand-mark"><svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M5 11h8c6 0 6 10 13 10M3 18h7c6 0 6-10 13-10M7 25h7c6 0 6-10 13-10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /></svg></span><span>FlowDesk<span className="brand-dot">®</span></span></span>;
}
export function Button({ children, variant = 'primary', busy = false, className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'dark' | 'danger'; busy?: boolean }) {
  return <button {...props} disabled={props.disabled || busy} className={`btn btn-${variant} ${className}`}>{busy && <LoaderCircle size={16} className="spin" />}{children}</button>;
}
export function Status({ status }: { status: TaskStatus }) { return <span className={`status status-${status}`}><span />{statuses[status]}</span>; }
export function Modal({ title, subtitle, children, onClose, wide = false }: { title: string; subtitle?: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const old = document.body.style.overflow; document.body.style.overflow = 'hidden';
    ref.current?.focus();
    const listener = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const els = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href]') || []).filter(el => el.offsetParent !== null);
        const first = els[0], last = els[els.length - 1];
        if (!first) { e.preventDefault(); return; }
        if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || document.activeElement === ref.current)) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', listener);
    return () => { document.body.style.overflow = old; document.removeEventListener('keydown', listener); previous?.focus(); };
  }, [onClose]);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}><div className="modal-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button" aria-label="关闭弹窗" onClick={onClose}><X size={20} /></button></div>{children}</div></div>;
}
export function Empty({ title = '这里还没有内容', detail, action }: { title?: string; detail?: string; action?: ReactNode }) { return <div className="empty"><span className="empty-icon"><Inbox size={26} /></span><h3>{title}</h3><p>{detail}</p>{action}</div>; }
export function PageHead({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description: string; actions?: ReactNode }) { return <div className="page-head"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1><p>{description}</p></div><div className="page-actions">{actions}</div></div>; }
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) { return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>; }
export function SectionLabel({ children }: { children: ReactNode }) { return <div className="section-label"><span />{children}</div>; }
export function ArrowLink({ children, onClick }: { children: ReactNode; onClick: () => void }) { return <button className="text-link" onClick={onClick}>{children}<ArrowUpRight size={16} /></button>; }
export const formatTime = (value: string) => new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
export { ArrowUpRight, Check, ChevronRight };
