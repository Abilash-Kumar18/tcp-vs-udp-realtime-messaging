import React, { useEffect, useRef, useState } from 'react';

/* ------------------------------------------------------------------ *
 * Section wrapper + sticky-scroll navigation
 * ------------------------------------------------------------------ */

export function Section({ id, eyebrow, title, lead, children }) {
  return (
    <section className="section" id={id}>
      <div className="shell">
        <div className="section-head">
          {eyebrow && <div className="eyebrow">{eyebrow}</div>}
          <h2>{title}</h2>
          {lead && <p>{lead}</p>}
        </div>
        {children}
      </div>
    </section>
  );
}

export function Nav({ links }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(links[0].id);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActive(visible.target.id);
      },
      { rootMargin: '-20% 0px -65% 0px', threshold: [0.05, 0.3, 0.6] },
    );

    for (const link of links) {
      const el = document.getElementById(link.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [links]);

  return (
    <nav className="nav">
      <div className="shell nav-inner">
        <a className="brand" href="#top" onClick={() => setOpen(false)}>
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
          </span>
          TCP vs UDP Lab
        </a>

        <button
          className="nav-toggle"
          aria-label="Toggle navigation"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          ☰
        </button>

        <div className={`nav-links ${open ? 'open' : ''}`}>
          {links.map((link) => (
            <a
              key={link.id}
              href={`#${link.id}`}
              className={active === link.id ? 'active' : ''}
              onClick={() => setOpen(false)}
            >
              {link.label}
            </a>
          ))}
        </div>
      </div>
    </nav>
  );
}

/* ------------------------------------------------------------------ *
 * Primitives
 * ------------------------------------------------------------------ */

export function Badge({ tone = 'mute', children, dot = false, className = '' }) {
  const dotClass = dot ? `dot ${dot}` : '';
  return (
    <span className={`badge badge-${tone} ${className}`}>
      {dot && <i className={dotClass} aria-hidden="true" />}
      {children}
    </span>
  );
}

export function Stat({ label, value, sub, tone = '' }) {
  return (
    <dl className={`stat ${tone}`}>
      <dt>{label}</dt>
      <dd>
        {value}
        {sub && <small>{sub}</small>}
      </dd>
    </dl>
  );
}

export function Card({ tone, title, aside, children, className = '', tight = false }) {
  return (
    <div className={`card ${tight ? 'card-tight' : ''} ${tone ? `proto-card ${tone}` : ''} ${className}`}>
      {(title || aside) && (
        <div className="card-title">
          {title}
          {aside}
        </div>
      )}
      {children}
    </div>
  );
}

export function Note({ tone = '', children }) {
  return (
    <div className={`note ${tone}`}>
      <div>{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Timestamped, scrollable log box
 * ------------------------------------------------------------------ */

const LEVEL_TAG = {
  out: 'SEND',
  in: 'ACK',
  ok: 'OK',
  warn: 'WARN',
  error: 'LOST',
  info: 'INFO',
};

export function LogBox({ entries, emptyText, footLeft, footRight, proto }) {
  const ref = useRef(null);
  const pinned = useRef(true);

  // Keep the newest line in view, unless the reader has scrolled up.
  useEffect(() => {
    const el = ref.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [entries]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  return (
    <>
      <div
        className="log"
        ref={ref}
        onScroll={onScroll}
        role="log"
        aria-live="polite"
        aria-label={`${proto} message log`}
      >
        {entries.length === 0 ? (
          <div className="log log-empty-box" style={{ height: '100%' }}>
            <span className="log-empty">{emptyText}</span>
          </div>
        ) : (
          entries.map((e, i) => (
            <div key={`${e.id}-${i}`} className={`log-row lv-${e.level}`}>
              <span className="log-ts">{e.time}</span>
              <span className="log-tag">{LEVEL_TAG[e.level] ?? e.level}</span>
              <span className="log-body">{e.text}</span>
            </div>
          ))
        )}
      </div>
      {(footLeft || footRight) && (
        <div className="log-foot">
          <span>{footLeft}</span>
          <span>{footRight}</span>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Formatting helpers
 * ------------------------------------------------------------------ */

export function ms(value, digits = 2) {
  if (value == null || Number.isNaN(value)) return '—';
  return `${Number(value).toFixed(digits)} ms`;
}

export function num(value) {
  if (value == null || Number.isNaN(value)) return '—';
  return Number(value).toLocaleString();
}

export function pct(value, digits = 1) {
  if (value == null || Number.isNaN(value)) return '—';
  return `${Number(value).toFixed(digits)}%`;
}

export function clockTime(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}