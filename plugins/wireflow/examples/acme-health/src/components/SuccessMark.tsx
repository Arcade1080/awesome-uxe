// Produkt-Komponente: Das Design System hat (noch) keine Erfolgs-Illustration.
// Im Screen markiert Wireflow Studio sie deshalb als DS-Lücke.
export function SuccessMark({ title, text, ...rest }: { title: string; text?: string } & Record<string, unknown>) {
  const data = Object.fromEntries(Object.entries(rest).filter(([k]) => k.startsWith('data-')));
  return (
    <div {...data} style={{ display: 'grid', justifyItems: 'center', gap: 8, padding: '28px 6px 6px', textAlign: 'center' }}>
      <span style={{ display: 'grid', placeItems: 'center', width: 76, height: 76, borderRadius: 999, background: 'var(--color-feedback-success-subtle)', color: 'var(--color-feedback-success)', fontSize: 34 }}>✓</span>
      <strong style={{ fontSize: 'var(--font-size-title)' }}>{title}</strong>
      {text && <span style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>{text}</span>}
    </div>
  );
}
