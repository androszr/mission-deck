// Prototype kit DS - component adapters.
//
// Prototypes import controls ONLY from here (`../../ds`). In the original
// setup these adapters wrap the production UI library, so a prototype looks
// and behaves like the product without importing the library directly; here
// they are small, dependency-free implementations with the same role. A team
// with its own component library re-points each adapter at it and keeps the
// props - every prototype keeps working.
//
// Rules the adapters encode so prototypes cannot get them wrong:
//   - every control has :hover, :focus-visible and disabled states;
//   - icons are currentColor stroke icons (tint with `color`);
//   - floating layers (modal, sheet, toast) render into the viewer's overlay
//     root, so they stay inside the device canvas;
//   - a layer can carry `trackScreen`, the screen name analytics groups
//     clicks by (layers live outside the screen's DOM subtree).

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ICONS, type IconName } from './icons';
import './ds.css';

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

function overlayRoot(): Element {
  return document.querySelector('[data-proto-overlay-root]') ?? document.body;
}

// ---- Icon -------------------------------------------------------------------

// A CSS mask over the SVG the build keeps in public/ds-icons/, painted with
// currentColor. The icon files come from assets/icons/ds/ (see ./icons.ts).
export function DSIcon({ name, size = 20, label, className }: { name: IconName; size?: number; label?: string; className?: string }) {
  const style = { width: size, height: size, '--ds-icon-src': `url(/ds-icons/${ICONS[name]}.svg)` } as CSSProperties;
  return (
    <span
      className={cx('ds-icon', className)}
      style={style}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}

// ---- Buttons ----------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'small' | 'medium' | 'large';

export function DSButton({
  variant = 'primary',
  size = 'medium',
  icon,
  iconRight,
  fullWidth,
  disabled,
  onClick,
  type = 'button',
  ariaLabel,
  children,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconRight?: IconName;
  fullWidth?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  type?: 'button' | 'submit';
  ariaLabel?: string;
  children?: ReactNode;
}) {
  const iconSize = size === 'small' ? 16 : 20;
  return (
    <button
      type={type}
      className={cx('ds-btn', `ds-btn--${variant}`, `ds-btn--${size}`, fullWidth && 'ds-btn--full')}
      disabled={disabled}
      onClick={onClick}
      aria-label={ariaLabel}
    >
      {icon && <DSIcon name={icon} size={iconSize} />}
      {children && <span className="ds-btn__label">{children}</span>}
      {iconRight && <DSIcon name={iconRight} size={iconSize} />}
    </button>
  );
}

export function DSIconButton({
  icon,
  label,
  onClick,
  variant = 'ghost',
  size = 'medium',
  pressed,
  badge,
}: {
  icon: IconName;
  label: string;
  onClick?: () => void;
  variant?: 'ghost' | 'secondary' | 'inverse';
  size?: 'small' | 'medium';
  pressed?: boolean;
  badge?: number;
}) {
  return (
    <button
      type="button"
      className={cx('ds-icon-btn', `ds-icon-btn--${variant}`, `ds-icon-btn--${size}`)}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
    >
      <DSIcon name={icon} size={size === 'small' ? 16 : 20} />
      {badge ? <span className="ds-icon-btn__badge">{badge}</span> : null}
    </button>
  );
}

// ---- Badge, avatar, divider -------------------------------------------------

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

export function DSBadge({ tone = 'neutral', dot, children }: { tone?: Tone; dot?: boolean; children: ReactNode }) {
  return (
    <span className={cx('ds-badge', `ds-badge--${tone}`)}>
      {dot && <span className="ds-badge__dot" aria-hidden />}
      {children}
    </span>
  );
}

export function DSAvatar({ name, size = 32, tone = 'accent' }: { name: string; size?: number; tone?: Tone }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
  return (
    <span className={cx('ds-avatar', `ds-avatar--${tone}`)} style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }} aria-label={name} role="img">
      {initials}
    </span>
  );
}

export function DSDivider() {
  return <hr className="ds-divider" />;
}

// ---- Card -------------------------------------------------------------------

export function DSCard({
  children,
  onClick,
  selected,
  padding = 'medium',
  className,
  ariaLabel,
}: {
  children: ReactNode;
  onClick?: () => void;
  selected?: boolean;
  padding?: 'none' | 'small' | 'medium' | 'large';
  className?: string;
  ariaLabel?: string;
}) {
  const interactive = Boolean(onClick);
  return (
    <div
      className={cx('ds-card', `ds-card--pad-${padding}`, interactive && 'ds-card--interactive', selected && 'ds-card--selected', className)}
      onClick={onClick}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-pressed={interactive ? Boolean(selected) : undefined}
      aria-label={ariaLabel}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
    >
      {children}
    </div>
  );
}

// ---- Callout ----------------------------------------------------------------

const CALLOUT_ICON: Record<'info' | 'success' | 'warning' | 'danger', IconName> = {
  info: 'info',
  success: 'check-circle',
  warning: 'alert',
  danger: 'alert',
};

export function DSCallout({ variant = 'info', title, children, action }: { variant?: 'info' | 'success' | 'warning' | 'danger'; title?: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={cx('ds-callout', `ds-callout--${variant}`)} role={variant === 'danger' ? 'alert' : 'status'}>
      <DSIcon name={CALLOUT_ICON[variant]} className="ds-callout__icon" />
      <div className="ds-callout__body">
        {title && <div className="ds-callout__title">{title}</div>}
        {children && <div className="ds-callout__text">{children}</div>}
      </div>
      {action && <div className="ds-callout__action">{action}</div>}
    </div>
  );
}

// ---- Form controls ----------------------------------------------------------

export function DSInput({
  label,
  value,
  onChange,
  placeholder,
  icon,
  multiline,
  rows = 3,
  hint,
  ariaLabel,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  icon?: IconName;
  multiline?: boolean;
  rows?: number;
  hint?: string;
  ariaLabel?: string;
}) {
  const id = useId();
  return (
    <div className="ds-field">
      {label && (
        <label className="ds-field__label" htmlFor={id}>
          {label}
        </label>
      )}
      <div className={cx('ds-input', icon && 'ds-input--icon', multiline && 'ds-input--multiline')}>
        {icon && <DSIcon name={icon} size={18} className="ds-input__icon" />}
        {multiline ? (
          <textarea id={id} value={value} rows={rows} placeholder={placeholder} aria-label={ariaLabel} onChange={(e) => onChange(e.target.value)} />
        ) : (
          <input id={id} value={value} placeholder={placeholder} aria-label={ariaLabel} onChange={(e) => onChange(e.target.value)} />
        )}
      </div>
      {hint && <div className="ds-field__hint">{hint}</div>}
    </div>
  );
}

export function DSSelect({
  label,
  value,
  options,
  onChange,
  ariaLabel,
}: {
  label?: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  ariaLabel?: string;
}) {
  const id = useId();
  return (
    <div className="ds-field">
      {label && (
        <label className="ds-field__label" htmlFor={id}>
          {label}
        </label>
      )}
      <div className="ds-select">
        <select id={id} value={value} aria-label={ariaLabel} onChange={(e) => onChange(e.target.value)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <DSIcon name="chevron-down" size={16} className="ds-select__chevron" />
      </div>
    </div>
  );
}

// The whole row is the hit area: clicking the label or the description
// toggles the box exactly once (a common prototype defect otherwise).
export function DSCheckbox({ checked, onChange, label, description }: { checked: boolean; onChange: (checked: boolean) => void; label: string; description?: string }) {
  return (
    <label className={cx('ds-checkbox', checked && 'ds-checkbox--checked')}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="ds-checkbox__box" aria-hidden>
        {checked && <DSIcon name="check" size={14} />}
      </span>
      <span className="ds-checkbox__text">
        <span className="ds-checkbox__label">{label}</span>
        {description && <span className="ds-checkbox__desc">{description}</span>}
      </span>
    </label>
  );
}

export function DSCounter({ value, onChange, min = 0, max = 99, label }: { value: number; onChange: (v: number) => void; min?: number; max?: number; label: string }) {
  return (
    <div className="ds-counter" role="group" aria-label={label}>
      <button type="button" aria-label={`Decrease ${label}`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>
        <span aria-hidden>-</span>
      </button>
      <span className="ds-counter__value" aria-live="polite">
        {value}
      </span>
      <button type="button" aria-label={`Increase ${label}`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}>
        <DSIcon name="plus" size={16} />
      </button>
    </div>
  );
}

// ---- Tabs -------------------------------------------------------------------

export function DSTabs<T extends string>({
  items,
  value,
  onChange,
  ariaLabel,
  variant = 'underline',
}: {
  items: Array<{ id: T; label: string; count?: number }>;
  value: T;
  onChange: (id: T) => void;
  ariaLabel: string;
  variant?: 'underline' | 'pill';
}) {
  return (
    <div className={cx('ds-tabs', `ds-tabs--${variant}`)} role="tablist" aria-label={ariaLabel}>
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          role="tab"
          aria-selected={it.id === value}
          className={cx('ds-tabs__tab', it.id === value && 'ds-tabs__tab--active')}
          onClick={() => onChange(it.id)}
        >
          {it.label}
          {typeof it.count === 'number' && <span className="ds-tabs__count">{it.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ---- Table ------------------------------------------------------------------

export interface DSTableColumn<Row> {
  key: string;
  header: string;
  render: (row: Row) => ReactNode;
  sort?: 'ascending' | 'descending' | 'none';
  /** Class on this column's header and cells (e.g. to hide it in a narrow container). */
  className?: string;
  /** Fixed column width in px; any column with one switches the table to fixed layout. */
  width?: number;
}

// A real <table> with DS classes. `caption` names it for assistive tech;
// a column's `sort` is passed through as aria-sort (the prototype sorts).
export function DSTable<Row>({
  columns,
  rows,
  rowKey,
  caption,
  onRowClick,
  selectedKey,
  rowClassName,
}: {
  columns: Array<DSTableColumn<Row>>;
  rows: Row[];
  rowKey: (row: Row) => string;
  caption?: string;
  onRowClick?: (row: Row) => void;
  selectedKey?: string;
  rowClassName?: (row: Row) => string | undefined;
}) {
  const fixed = columns.some((c) => c.width !== undefined);
  return (
    <div className="ds-table-wrap">
      <table className="ds-table" style={fixed ? { tableLayout: 'fixed' } : undefined}>
        {caption && <caption>{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" aria-sort={c.sort} className={c.className} style={c.width !== undefined ? { width: c.width } : undefined}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const key = rowKey(row);
            return (
              <tr
                key={key}
                className={cx(onRowClick && 'ds-table__row--interactive', rowClassName?.(row))}
                aria-selected={onRowClick ? key === selectedKey : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={
                  onRowClick
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onRowClick(row);
                        }
                      }
                    : undefined
                }
              >
                {columns.map((c) => (
                  <td key={c.key} className={c.className}>
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---- Progress, loader, empty ------------------------------------------------

export function DSProgress({ value, max = 100, label, tone = 'accent' }: { value: number; max?: number; label?: string; tone?: Tone }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="ds-progress" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
      <div className={cx('ds-progress__bar', `ds-progress__bar--${tone}`)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function DSLoader({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="ds-loader" role="status">
      <span className="ds-loader__spinner" aria-hidden />
      <span className="ds-loader__label">{label}</span>
    </div>
  );
}

export function DSEmpty({ icon = 'list', title, description, children }: { icon?: IconName; title: string; description?: string; children?: ReactNode }) {
  return (
    <div className="ds-empty">
      <span className="ds-empty__icon">
        <DSIcon name={icon} size={28} />
      </span>
      <div className="ds-empty__title">{title}</div>
      {description && <div className="ds-empty__desc">{description}</div>}
      {children && <div className="ds-empty__actions">{children}</div>}
    </div>
  );
}

// ---- Floating layers --------------------------------------------------------

function useEscape(open: boolean, onClose: () => void) {
  const ref = useRef(onClose);
  useEffect(() => {
    ref.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') ref.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
}

export function DSModal({
  open,
  title,
  onClose,
  children,
  footer,
  width = 560,
  trackScreen,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  trackScreen?: string;
}) {
  useEscape(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="ds-layer ds-layer--center" data-track-screen={trackScreen}>
      <div className="ds-layer__scrim" onClick={onClose} />
      <div className="ds-modal" role="dialog" aria-modal="true" aria-label={title} style={{ maxWidth: width }}>
        <div className="ds-modal__head">
          <div className="ds-modal__title">{title}</div>
          <DSIconButton icon="close" label="Close" onClick={onClose} />
        </div>
        <div className="ds-modal__body">{children}</div>
        {footer && <div className="ds-modal__foot">{footer}</div>}
      </div>
    </div>,
    overlayRoot(),
  );
}

export function DSBottomSheet({
  open,
  title,
  onClose,
  children,
  footer,
  trackScreen,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  trackScreen?: string;
}) {
  useEscape(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="ds-layer ds-layer--bottom" data-track-screen={trackScreen}>
      <div className="ds-layer__scrim" onClick={onClose} />
      <div className="ds-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="ds-sheet__grip" aria-hidden />
        <div className="ds-sheet__head">
          <div className="ds-sheet__title">{title}</div>
          <DSIconButton icon="close" label="Close" onClick={onClose} />
        </div>
        <div className="ds-sheet__body">{children}</div>
        {footer && <div className="ds-sheet__foot">{footer}</div>}
      </div>
    </div>,
    overlayRoot(),
  );
}

// A toast is controlled by the caller (`open`), and closes itself after
// `duration` ms through onClose. Demo states open it directly.
export function DSToast({ open, message, tone = 'success', onClose, duration = 4000 }: { open: boolean; message: string; tone?: 'success' | 'info' | 'danger'; onClose: () => void; duration?: number }) {
  const ref = useRef(onClose);
  useEffect(() => {
    ref.current = onClose;
  });
  useEffect(() => {
    if (!open || duration <= 0) return;
    const t = window.setTimeout(() => ref.current(), duration);
    return () => window.clearTimeout(t);
  }, [open, duration]);
  if (!open) return null;
  return createPortal(
    <div className={cx('ds-toast', `ds-toast--${tone}`)} role="status">
      <DSIcon name={tone === 'danger' ? 'alert' : 'check-circle'} size={18} />
      <span>{message}</span>
    </div>,
    overlayRoot(),
  );
}

// Small hook used by adapters and prototypes alike: a value that follows a
// prop but can be changed locally (e.g. a filter seeded by a demo state).
export function useSeededState<T>(seed: T): [T, (v: T) => void] {
  const [state, setState] = useState(seed);
  const [prevSeed, setPrevSeed] = useState(seed);
  if (seed !== prevSeed) {
    setPrevSeed(seed);
    setState(seed);
  }
  return [state, setState];
}
