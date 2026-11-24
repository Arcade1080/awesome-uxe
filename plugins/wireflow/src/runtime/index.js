// @wireflow/runtime – die einzige Abhängigkeit eines Screen-Moduls außer dem Design System.
// Im Canvas meldet sie Interaktionen an den Prototyp; im Produkt ersetzt das Team sie
// durch den eigenen Router (gleiche Signatur: trigger(id) liefert einen Handler).
const state = () => (typeof window !== 'undefined' && window.__WF__) || {};

function post(msg) {
  try {
    if (typeof window !== 'undefined' && window.parent !== window) {
      window.parent.postMessage({ wf: 1, ref: state().ref, ...msg }, window.location.origin);
    }
  } catch {
    /* außerhalb des Canvas: nichts zu tun */
  }
}

export const flow = {
  /** Handler für ein Element mit data-wf-ID: löst die im Flow hinterlegte Verbindung aus. */
  trigger(id) {
    return () => post({ type: 'trigger', el: id });
  },
  /** Zurück zum vorherigen Screen des Prototyps. */
  back() {
    post({ type: 'back' });
  },
  /** Aktuelle Flow-Variablen (z. B. angemeldet, slotFrei). */
  get vars() {
    return state().vars || {};
  },
};

export default flow;
