// Acme UI – kleines, fiktives Design System für das Wireflow-Studio-Beispiel.
// Alle Komponenten reichen data-*-Attribute an ihr Wurzelelement durch,
// damit der Canvas Elemente über data-wf auswählen kann.
import { useState, type ReactNode } from 'react';

type Rest = Record<string, unknown>;
const data = (rest: Rest) => Object.fromEntries(Object.entries(rest).filter(([k]) => k.startsWith('data-') || k.startsWith('aria-')));
const tok = (t?: string) => (t ? `var(--${t.replace(/\./g, '-')})` : undefined);

const ICONS: Record<string, ReactNode> = {
  search: <path d="M9 3.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11zM13 13l4 4" />,
  pin: <path d="M10 17.5s5.5-5 5.5-9a5.5 5.5 0 0 0-11 0c0 4 5.5 9 5.5 9zM10 6.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4z" />,
  clock: <path d="M10 3a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM10 6v4l2.8 1.8" />,
  info: <path d="M10 2.5a7.5 7.5 0 1 1 0 15 7.5 7.5 0 0 1 0-15zM10 9v4.5M10 6.5v.2" />,
  warn: <path d="M10 3l7.5 13.5h-15zM10 8.5V12M10 14.3v.2" />,
  check: <path d="M4.5 10.5l3.5 3.5 7.5-8" />,
};
export function Icon({ name }: { name: string }) {
  return (
    <svg className="acme-icon" viewBox="0 0 20 20" aria-hidden="true">
      {ICONS[name] || null}
    </svg>
  );
}

export function Page({ padding = 'space.4', gap = 'space.3', children, ...rest }: { padding?: string; gap?: string; children?: ReactNode } & Rest) {
  return (
    <main className="acme-page" style={{ padding: tok(padding), gap: tok(gap) }} {...data(rest)}>
      {children}
    </main>
  );
}

export function AppBar({ title, subtitle, onBack, ...rest }: { title: string; subtitle?: string; onBack?: () => void } & Rest) {
  return (
    <header className="acme-appbar" {...data(rest)}>
      {onBack && (
        <button type="button" className="acme-appbar__back" aria-label="Zurück" onClick={onBack}>
          ‹
        </button>
      )}
      <div>
        <div className="acme-appbar__title">{title}</div>
        {subtitle && <div className="acme-appbar__sub">{subtitle}</div>}
      </div>
    </header>
  );
}

export function Heading({ level = 1, children, ...rest }: { level?: 1 | 2; children?: ReactNode } & Rest) {
  const Tag = level === 1 ? 'h1' : 'h2';
  return (
    <Tag className={`acme-heading acme-heading--${level}`} {...data(rest)}>
      {children}
    </Tag>
  );
}

export function Text({ tone = 'default', icon, children, ...rest }: { tone?: 'default' | 'muted'; icon?: string; children?: ReactNode } & Rest) {
  return (
    <p className={`acme-text acme-text--${tone}`} {...data(rest)}>
      {icon && <Icon name={icon} />}
      <span>{children}</span>
    </p>
  );
}

export function TextField({ label, defaultValue, placeholder, type = 'text', icon, ...rest }: { label: string; defaultValue?: string; placeholder?: string; type?: string; icon?: string } & Rest) {
  return (
    <label className="acme-field" {...data(rest)}>
      <span className="acme-field__label">{label}</span>
      <span className="acme-field__box">
        {icon && <Icon name={icon} />}
        <input type={type} defaultValue={defaultValue} placeholder={placeholder} />
      </span>
    </label>
  );
}

export function Select({ label, value, options, ...rest }: { label: string; value?: string; options?: string[] } & Rest) {
  const opts = options && options.length ? options : value ? [value] : [];
  return (
    <label className="acme-field" {...data(rest)}>
      <span className="acme-field__label">{label}</span>
      <span className="acme-field__box">
        <select defaultValue={value}>
          {opts.map(o => (
            <option key={o}>{o}</option>
          ))}
        </select>
      </span>
    </label>
  );
}

export function ChipGroup({ label, options, defaultValue, ...rest }: { label?: string; options: string[]; defaultValue?: string } & Rest) {
  const [value, setValue] = useState(defaultValue ?? options[0]);
  return (
    <div className="acme-chips" role="group" aria-label={label} {...data(rest)}>
      {label && <span className="acme-field__label">{label}</span>}
      <div className="acme-chips__row">
        {options.map(o => (
          <button type="button" key={o} className="acme-chip" aria-pressed={o === value} onClick={() => setValue(o)}>
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Button({ variant = 'primary', size = 'md', onPress, children, ...rest }: { variant?: 'primary' | 'secondary' | 'ghost'; size?: 'md' | 'lg'; onPress?: () => void; children?: ReactNode } & Rest) {
  return (
    <button type="button" className={`acme-btn acme-btn--${variant} acme-btn--${size}`} onClick={onPress} {...data(rest)}>
      {children}
    </button>
  );
}

export function Avatar({ initials, ...rest }: { initials: string } & Rest) {
  return (
    <span className="acme-avatar" {...data(rest)}>
      {initials}
    </span>
  );
}

export function Card({ title, subtitle, meta, badge, media, onPress, ...rest }: { title: string; subtitle?: string; meta?: string; badge?: string; media?: ReactNode; onPress?: () => void } & Rest) {
  const body = (
    <>
      {media}
      <span className="acme-card__body">
        <span className="acme-card__title">{title}</span>
        {subtitle && <span className="acme-card__sub">{subtitle}</span>}
        {meta && <span className="acme-card__meta">{meta}</span>}
        {badge && <span className="acme-badge">{badge}</span>}
      </span>
    </>
  );
  return onPress ? (
    <button type="button" className="acme-card acme-card--action" onClick={onPress} {...data(rest)}>
      {body}
    </button>
  ) : (
    <div className="acme-card" {...data(rest)}>
      {body}
    </div>
  );
}

export function SummaryList({ items, ...rest }: { items: [string, string][] } & Rest) {
  return (
    <dl className="acme-summary" {...data(rest)}>
      {items.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Checkbox({ label, defaultChecked, ...rest }: { label: string; defaultChecked?: boolean } & Rest) {
  return (
    <label className="acme-check" {...data(rest)}>
      <input type="checkbox" defaultChecked={defaultChecked} />
      <span>{label}</span>
    </label>
  );
}

export function Alert({ tone = 'info', title, children, ...rest }: { tone?: 'info' | 'danger' | 'success'; title: string; children?: ReactNode } & Rest) {
  return (
    <div className={`acme-alert acme-alert--${tone}`} role={tone === 'danger' ? 'alert' : 'status'} {...data(rest)}>
      <Icon name={tone === 'danger' ? 'warn' : tone === 'success' ? 'check' : 'info'} />
      <div>
        <strong>{title}</strong>
        {children && <div>{children}</div>}
      </div>
    </div>
  );
}

export function Spacer(rest: Rest) {
  return <div className="acme-spacer" {...data(rest)} />;
}
