// Dispatch console - DESKTOP example prototype.
//
// Question this prototype tests with dispatchers: can they triage the
// morning's alarms and assign the right technician in under a minute, without
// phoning around? Scope: work-order list with filters, detail panel, the
// "Assign technician" window with a best-match suggestion, and the crew board.
//
// Contract (docs/02-prototype-contract.md):
//   default export, `breakpoints`, `demoStates` read through useDemoState,
//   imports only from react / ./styles.css / ./*.json / ../_shared/* /
//   ../../ds / ../../components, tokens only, @container proto only,
//   every screen and window named with data-track-screen, screen state in the
//   hash (#/work-orders/<id>, #/crew), meaningful actions tracked.

import { useEffect, useMemo, useState } from 'react';
import './styles.css';
import data from './data.json';
import { useDemoState, hasDemoStateParam, type DemoStateDef } from '../_shared/demo-state';
import { track } from '../_shared/analytics';
import { AppFrame, NotInPrototype, type NavItem, type Persona } from '../../components';
import {
  DSAvatar,
  DSBadge,
  DSButton,
  DSCallout,
  DSCard,
  DSEmpty,
  DSIcon,
  DSIconButton,
  DSInput,
  DSLoader,
  DSModal,
  DSProgress,
  DSSelect,
  DSTable,
  DSTabs,
  DSToast,
  type DSTableColumn,
  type Tone,
} from '../../ds';

const PROTOTYPE_ID = 'proto-7f3a91c0d2e4';

// The fictional product's menu and user, passed to the neutral app frame.
const NAV: NavItem[] = [
  { id: 'home', label: 'Overview', icon: 'home' },
  { id: 'work-orders', label: 'Work orders', icon: 'wrench' },
  { id: 'crew', label: 'Crew board', icon: 'users' },
  { id: 'assets', label: 'Turbines', icon: 'turbine' },
  { id: 'parts', label: 'Spare parts', icon: 'package' },
  { id: 'reports', label: 'Reports', icon: 'gauge' },
];
const PERSONA: Persona = { name: 'Morgan Ellis', role: 'Dispatcher, North Coast region' };

export const breakpoints = [1280, 1536, 1920];

export const demoStates: DemoStateDef[] = [
  { id: 'list', label: 'Work orders - morning queue', group: 'Work orders' },
  { id: 'list-critical', label: 'Filtered to critical', group: 'Work orders' },
  { id: 'detail', label: 'Detail panel open (WO-1042)', group: 'Work orders' },
  { id: 'assign', label: 'Assign technician - window open', group: 'Assign' },
  { id: 'assign-chosen', label: 'Assign technician - best match chosen', group: 'Assign' },
  { id: 'assigned', label: 'Assigned - confirmation toast', group: 'Assign' },
  { id: 'crew', label: 'Crew board', group: 'Crew board' },
  { id: 'empty', label: 'No results for a search', group: 'Edge states' },
  { id: 'loading', label: 'Loading', group: 'Edge states' },
  { id: 'error', label: 'Error and retry', group: 'Edge states' },
  { id: 'rail-collapsed', label: 'Menu rail collapsed', group: 'Frame' },
];

// ---- data -------------------------------------------------------------------

type Priority = 'critical' | 'high' | 'medium' | 'low';
type Status = 'open' | 'scheduled' | 'in-progress' | 'done';
type Level = 'success' | 'warning' | 'danger';

interface Reading {
  label: string;
  value: number;
  max: number;
  unit: string;
  level: Level;
}
interface WorkOrder {
  id: string;
  turbine: string;
  site: string;
  title: string;
  code: string;
  type: string;
  priority: Priority;
  status: Status;
  due: string;
  reported: string;
  estimateH: number;
  assignee: string | null;
  skills: string[];
  lostMWh: number;
  readings: Reading[];
  history: Array<{ when: string; text: string }>;
}
interface Technician {
  id: string;
  name: string;
  base: string;
  skills: string[];
  status: 'available' | 'on-job' | 'off';
  loadH: number;
  distanceKm: number;
  jobs: string[];
}

const ORDERS = data.workOrders as WorkOrder[];
const TECHS = data.technicians as Technician[];

const PRIORITY: Record<Priority, { label: string; tone: Tone; rank: number }> = {
  critical: { label: 'Critical', tone: 'danger', rank: 0 },
  high: { label: 'High', tone: 'warning', rank: 1 },
  medium: { label: 'Medium', tone: 'info', rank: 2 },
  low: { label: 'Low', tone: 'neutral', rank: 3 },
};
const STATUS: Record<Status, { label: string; tone: Tone }> = {
  open: { label: 'Open', tone: 'accent' },
  scheduled: { label: 'Scheduled', tone: 'info' },
  'in-progress': { label: 'In progress', tone: 'warning' },
  done: { label: 'Done', tone: 'success' },
};
const TECH_STATUS: Record<Technician['status'], { label: string; tone: Tone }> = {
  available: { label: 'Available', tone: 'success' },
  'on-job': { label: 'On a job', tone: 'warning' },
  off: { label: 'Off today', tone: 'neutral' },
};

type StatusTab = 'open' | 'scheduled' | 'in-progress' | 'done';
type LoadState = 'ready' | 'loading' | 'error';

/** Fits the day first, free now before busy, then skill match, distance, free hours. Top = "Best match". */
function rankTechs(order: WorkOrder): Array<Technician & { match: number; fits: boolean }> {
  return TECHS.map((t) => {
    const match = order.skills.filter((s) => t.skills.includes(s)).length;
    const fits = t.status !== 'off' && t.loadH + order.estimateH <= 8;
    return { ...t, match, fits };
  }).sort(
    (a, b) =>
      Number(b.fits) - Number(a.fits) ||
      Number(b.status === 'available') - Number(a.status === 'available') ||
      b.match - a.match ||
      a.distanceKm - b.distanceKm ||
      a.loadH - b.loadH,
  );
}

// ---- hash routing: #/work-orders[/<id>] | #/crew | #/<nav id> --------------

interface Route {
  nav: string;
  orderId: string | null;
}

function parseHash(raw: string): Route {
  const parts = raw.replace(/^#\/?/, '').split('/').filter(Boolean);
  const nav = parts[0] || 'work-orders';
  return { nav, orderId: nav === 'work-orders' ? parts[1] ?? null : null };
}

function hashFor(r: Route): string {
  return r.orderId ? `#/${r.nav}/${r.orderId}` : `#/${r.nav}`;
}

// ---- component --------------------------------------------------------------

// One scenario = the interaction state a demo state starts from. Everything
// not named here is the baseline. The console below is keyed on the demo
// state, so a new state remounts it with this state as its initial values
// (no effect that sets state).
interface Scenario {
  route: Route | null; // null keeps the address as it is (a deep link on first load)
  orders: WorkOrder[];
  tab: StatusTab;
  query: string;
  priority: 'all' | Priority;
  load: LoadState;
  assignFor: string | null;
  chosenTech: string | null;
  toast: string | null;
  railCollapsed: boolean;
}

function scenarioFor(demoState: string): Scenario {
  const wo: Route = { nav: 'work-orders', orderId: null };
  const base: Scenario = {
    route: wo, orders: ORDERS, tab: 'open', query: '', priority: 'all', load: 'ready',
    assignFor: null, chosenTech: null, toast: null, railCollapsed: false,
  };
  switch (demoState) {
    case 'list-critical':
      return { ...base, priority: 'critical' };
    case 'detail':
      return { ...base, route: { nav: 'work-orders', orderId: 'WO-1042' } };
    case 'assign':
      return { ...base, route: { nav: 'work-orders', orderId: 'WO-1042' }, assignFor: 'WO-1042' };
    case 'assign-chosen':
      return { ...base, route: { nav: 'work-orders', orderId: 'WO-1042' }, assignFor: 'WO-1042', chosenTech: 't3' };
    case 'assigned':
      return {
        ...base,
        orders: ORDERS.map((o) => (o.id === 'WO-1042' ? { ...o, status: 'scheduled', assignee: 't3' } : o)),
        tab: 'scheduled',
        toast: 'WO-1042 assigned to Lena Fischer - she gets it on her phone now.',
        route: { nav: 'work-orders', orderId: 'WO-1042' },
      };
    case 'crew':
      return { ...base, route: { nav: 'crew', orderId: null } };
    case 'empty':
      return { ...base, query: 'blade crack' };
    case 'loading':
      return { ...base, load: 'loading' };
    case 'error':
      return { ...base, load: 'error' };
    case 'rail-collapsed':
      return { ...base, railCollapsed: true };
    case 'list':
    default:
      // A plain first load keeps a deep link (#/crew); an explicit ?state=list resets to the list.
      return hasDemoStateParam() ? base : { ...base, route: null };
  }
}

export default function DispatchConsole() {
  const demoState = useDemoState(demoStates, 'list');
  return <Console key={demoState} demoState={demoState} />;
}

function Console({ demoState }: { demoState: string }) {
  const [start] = useState(() => scenarioFor(demoState));
  const [route, setRoute] = useState<Route>(() => start.route ?? parseHash(window.location.hash));
  const [orders, setOrders] = useState<WorkOrder[]>(start.orders);
  const [tab, setTab] = useState<StatusTab>(start.tab);
  const [query, setQuery] = useState(start.query);
  const [priority, setPriority] = useState<'all' | Priority>(start.priority);
  const [site, setSite] = useState('all');
  const [load, setLoad] = useState<LoadState>(start.load);
  const [assignFor, setAssignFor] = useState<string | null>(start.assignFor);
  const [chosenTech, setChosenTech] = useState<string | null>(start.chosenTech);
  const [toast, setToast] = useState<string | null>(start.toast);
  const [railCollapsed, setRailCollapsed] = useState(start.railCollapsed);

  useEffect(() => {
    // A scenario writes its screen into the address so a reload lands on it.
    if (start.route) window.history.replaceState(null, '', window.location.pathname + window.location.search + hashFor(start.route));
    const onHash = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [start]);

  const navigate = (r: Route) => {
    window.location.hash = hashFor(r).slice(1);
  };

  const onNav = (id: string) => {
    track('Nav Selected', { prototype: PROTOTYPE_ID, target: id });
    navigate({ nav: id, orderId: null });
  };

  const confirmAssign = () => {
    if (!assignFor || !chosenTech) return;
    const tech = TECHS.find((t) => t.id === chosenTech)!;
    track('Technician Assigned', { prototype: PROTOTYPE_ID, order: assignFor, technician: chosenTech });
    setOrders((prev) => prev.map((o) => (o.id === assignFor ? { ...o, status: 'scheduled', assignee: chosenTech } : o)));
    setToast(`${assignFor} assigned to ${tech.name} - they get it on their phone now.`);
    setTab('scheduled');
    setAssignFor(null);
    setChosenTech(null);
  };

  const navItem = NAV.find((n) => n.id === route.nav);
  let content;
  if (route.nav === 'work-orders') {
    content = (
      <WorkOrdersScreen
        orders={orders}
        tab={tab}
        onTab={setTab}
        query={query}
        onQuery={setQuery}
        priority={priority}
        onPriority={setPriority}
        site={site}
        onSite={setSite}
        load={load}
        onRetry={() => setLoad('ready')}
        selectedId={route.orderId}
        onSelect={(id) => {
          if (id) track('Work Order Opened', { prototype: PROTOTYPE_ID, order: id });
          navigate({ nav: 'work-orders', orderId: id });
        }}
        onAssign={(id) => {
          track('Assign Window Opened', { prototype: PROTOTYPE_ID, order: id });
          setAssignFor(id);
          setChosenTech(null);
        }}
      />
    );
  } else if (route.nav === 'crew') {
    content = <CrewBoard orders={orders} onOpenOrder={(id) => navigate({ nav: 'work-orders', orderId: id })} />;
  } else {
    content = <NotInPrototype label={navItem?.label ?? route.nav} />;
  }

  const assignOrder = orders.find((o) => o.id === assignFor) ?? null;

  return (
    <div className="dsp-root">
      <AppFrame
        activeNav={route.nav}
        onNavigate={onNav}
        nav={NAV}
        brand="Ops Console"
        brandIcon="turbine"
        persona={PERSONA}
        railCollapsed={railCollapsed}
        onRailToggle={setRailCollapsed}
        title="North Coast region"
      >
        {content}
      </AppFrame>
      <AssignWindow
        order={assignOrder}
        chosen={chosenTech}
        onChoose={(id) => {
          track('Technician Chosen', { prototype: PROTOTYPE_ID, technician: id });
          setChosenTech(id);
        }}
        onClose={() => {
          setAssignFor(null);
          setChosenTech(null);
        }}
        onConfirm={confirmAssign}
      />
      <DSToast open={toast !== null} message={toast ?? ''} onClose={() => setToast(null)} duration={hasDemoStateParam() && demoState === 'assigned' ? 0 : 4500} />
    </div>
  );
}

// ---- Work orders ------------------------------------------------------------

function WorkOrdersScreen(props: {
  orders: WorkOrder[];
  tab: StatusTab;
  onTab: (t: StatusTab) => void;
  query: string;
  onQuery: (q: string) => void;
  priority: 'all' | Priority;
  onPriority: (p: 'all' | Priority) => void;
  site: string;
  onSite: (s: string) => void;
  load: LoadState;
  onRetry: () => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onAssign: (id: string) => void;
}) {
  const { orders, tab, query, priority, site, load, selectedId } = props;
  const counts = useMemo(() => {
    const c: Record<StatusTab, number> = { open: 0, scheduled: 0, 'in-progress': 0, done: 0 };
    orders.forEach((o) => (c[o.status] += 1));
    return c;
  }, [orders]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders
      .filter((o) => o.status === tab)
      .filter((o) => priority === 'all' || o.priority === priority)
      .filter((o) => site === 'all' || o.site === site)
      .filter((o) => !q || `${o.id} ${o.turbine} ${o.title} ${o.code}`.toLowerCase().includes(q))
      .sort((a, b) => PRIORITY[a.priority].rank - PRIORITY[b.priority].rank);
  }, [orders, tab, priority, site, query]);

  const selected = orders.find((o) => o.id === selectedId) ?? null;
  const columns: Array<DSTableColumn<WorkOrder>> = [
    {
      key: 'order',
      header: 'Order',
      width: 170,
      render: (o) => (
        <>
          <div className="dsp-cell-strong">{o.id}</div>
          <div className="dsp-cell-sub">
            {o.turbine} - {o.site}
          </div>
        </>
      ),
    },
    {
      key: 'fault',
      header: 'Fault',
      className: 'dsp-cell-fault',
      render: (o) => (
        <>
          <div className="dsp-ellipsis" title={o.title}>
            {o.title}
          </div>
          <div className="dsp-cell-sub">{o.code}</div>
        </>
      ),
    },
    { key: 'type', header: 'Type', width: 120, className: 'dsp-col-type', render: (o) => o.type },
    {
      key: 'priority',
      header: 'Priority',
      width: 120,
      render: (o) => (
        <DSBadge tone={PRIORITY[o.priority].tone} dot>
          {PRIORITY[o.priority].label}
        </DSBadge>
      ),
    },
    { key: 'due', header: 'Due', width: 140, className: 'dsp-nowrap', render: (o) => o.due },
    {
      key: 'assignee',
      header: 'Assignee',
      width: 190,
      render: (o) => {
        const tech = TECHS.find((t) => t.id === o.assignee);
        return tech ? (
          <span className="dsp-assignee">
            <DSAvatar name={tech.name} size={24} tone="info" />
            <span className="dsp-ellipsis">{tech.name}</span>
          </span>
        ) : (
          <span className="dsp-unassigned">Unassigned</span>
        );
      },
    },
  ];
  const lost = orders.filter((o) => o.status === 'open').reduce((s, o) => s + o.lostMWh, 0);
  const critical = orders.filter((o) => o.status === 'open' && o.priority === 'critical').length;

  return (
    <div className={`dsp-wo${selected ? ' dsp-wo--with-panel' : ''}`} data-track-screen={selected ? 'Work orders > Detail panel' : 'Work orders > List'}>
      <div className="dsp-wo__main">
        <div className="dsp-head">
          <div>
            <h1 className="dsp-head__title">Work orders</h1>
            <div className="dsp-head__sub">{data.today} - North Coast region</div>
          </div>
          <DSButton variant="secondary" icon="plus">
            New work order
          </DSButton>
        </div>

        <div className="dsp-kpis">
          <Kpi icon="alert" tone="danger" value={String(critical)} label="critical alarms open" />
          <Kpi icon="bolt" tone="warning" value={`${lost.toFixed(1)} MWh`} label="production lost today" />
          <Kpi icon="users" tone="success" value={String(TECHS.filter((t) => t.status === 'available').length)} label="technicians available" />
        </div>

        <DSTabs
          ariaLabel="Status"
          value={tab}
          onChange={props.onTab}
          items={[
            { id: 'open', label: 'Open', count: counts.open },
            { id: 'scheduled', label: 'Scheduled', count: counts.scheduled },
            { id: 'in-progress', label: 'In progress', count: counts['in-progress'] },
            { id: 'done', label: 'Done', count: counts.done },
          ]}
        />

        <div className="dsp-filters">
          <div className="dsp-filters__search">
            <DSInput value={query} onChange={props.onQuery} placeholder="Search by order, turbine or fault code" icon="search" ariaLabel="Search work orders" />
          </div>
          <DSSelect
            ariaLabel="Priority"
            value={priority}
            onChange={(v) => props.onPriority(v as 'all' | Priority)}
            options={[{ value: 'all', label: 'All priorities' }, ...(Object.keys(PRIORITY) as Priority[]).map((p) => ({ value: p, label: PRIORITY[p].label }))]}
          />
          <DSSelect ariaLabel="Site" value={site} onChange={props.onSite} options={[{ value: 'all', label: 'All sites' }, ...data.sites.map((s) => ({ value: s, label: s }))]} />
        </div>

        <DSCard padding="none" className="dsp-table-card">
          {load === 'loading' && <DSLoader label="Loading work orders..." />}
          {load === 'error' && (
            <div className="dsp-error">
              <DSCallout variant="danger" title="Work orders could not be loaded" action={<DSButton variant="secondary" size="small" onClick={props.onRetry}>Try again</DSButton>}>
                This is a controlled demo error, not a connection problem.
              </DSCallout>
            </div>
          )}
          {load === 'ready' && rows.length === 0 && (
            <DSEmpty icon="search" title="No work orders match" description="Try another search term or clear the filters.">
              <DSButton
                variant="secondary"
                onClick={() => {
                  props.onQuery('');
                  props.onPriority('all');
                  props.onSite('all');
                }}
              >
                Clear filters
              </DSButton>
            </DSEmpty>
          )}
          {load === 'ready' && rows.length > 0 && (
            <DSTable
              caption="Work orders"
              columns={columns}
              rows={rows}
              rowKey={(o) => o.id}
              selectedKey={selectedId ?? undefined}
              rowClassName={(o) => (o.id === selectedId ? 'dsp-row dsp-row--selected' : 'dsp-row')}
              onRowClick={(o) => props.onSelect(o.id === selectedId ? null : o.id)}
            />
          )}
        </DSCard>
      </div>

      {selected && <DetailPanel order={selected} onClose={() => props.onSelect(null)} onAssign={() => props.onAssign(selected.id)} />}
    </div>
  );
}

function Kpi({ icon, tone, value, label }: { icon: 'alert' | 'bolt' | 'users'; tone: Tone; value: string; label: string }) {
  return (
    <DSCard padding="medium">
      <div className="dsp-kpi">
        <span className={`dsp-kpi__icon dsp-kpi__icon--${tone}`}>
          <DSIcon name={icon} />
        </span>
        <div>
          <div className="dsp-kpi__value">{value}</div>
          <div className="dsp-kpi__label">{label}</div>
        </div>
      </div>
    </DSCard>
  );
}

function DetailPanel({ order, onClose, onAssign }: { order: WorkOrder; onClose: () => void; onAssign: () => void }) {
  const tech = TECHS.find((t) => t.id === order.assignee);
  return (
    <aside className="dsp-panel" aria-label={`Work order ${order.id}`}>
      <div className="dsp-panel__head">
        <div className="dsp-panel__badges">
          <DSBadge tone={PRIORITY[order.priority].tone} dot>
            {PRIORITY[order.priority].label}
          </DSBadge>
          <DSBadge tone={STATUS[order.status].tone}>{STATUS[order.status].label}</DSBadge>
        </div>
        <DSIconButton icon="close" label="Close panel" onClick={onClose} />
      </div>
      <h2 className="dsp-panel__title">{order.title}</h2>
      <div className="dsp-panel__meta">
        <span>
          <DSIcon name="turbine" size={16} /> {order.turbine}
        </span>
        <span>
          <DSIcon name="map-pin" size={16} /> {order.site}
        </span>
        <span>
          <DSIcon name="clock" size={16} /> Due {order.due}
        </span>
      </div>

      {order.lostMWh > 0 && (
        <DSCallout variant="warning" title={`${order.lostMWh} MWh lost so far`}>
          Reported {order.reported}. Estimated repair {order.estimateH} h.
        </DSCallout>
      )}

      {order.readings.length > 0 && (
        <section className="dsp-panel__section">
          <h3>Live readings</h3>
          {order.readings.map((r) => (
            <div key={r.label} className="dsp-reading">
              <div className="dsp-reading__row">
                <span>{r.label}</span>
                <b>
                  {r.value} {r.unit}
                </b>
              </div>
              <DSProgress value={r.value} max={r.max} tone={r.level} label={r.label} />
            </div>
          ))}
        </section>
      )}

      <section className="dsp-panel__section">
        <h3>Skills needed</h3>
        <div className="dsp-chips">
          {order.skills.map((s) => (
            <DSBadge key={s}>{s}</DSBadge>
          ))}
        </div>
      </section>

      <section className="dsp-panel__section">
        <h3>History</h3>
        <ol className="dsp-history">
          {order.history.map((h) => (
            <li key={h.when + h.text}>
              <span className="dsp-history__when">{h.when}</span>
              <span>{h.text}</span>
            </li>
          ))}
        </ol>
      </section>

      <div className="dsp-panel__actions">
        {tech ? (
          <div className="dsp-assigned">
            <DSAvatar name={tech.name} size={32} tone="info" />
            <div>
              <div className="dsp-cell-strong">{tech.name}</div>
              <div className="dsp-cell-sub">Assigned - notified on phone</div>
            </div>
          </div>
        ) : (
          <DSButton icon="users" fullWidth onClick={onAssign}>
            Assign technician
          </DSButton>
        )}
      </div>
    </aside>
  );
}

// ---- Assign window ----------------------------------------------------------

function AssignWindow({
  order,
  chosen,
  onChoose,
  onClose,
  onConfirm,
}: {
  order: WorkOrder | null;
  chosen: string | null;
  onChoose: (id: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const ranked = order ? rankTechs(order) : [];
  const best = ranked[0];
  return (
    <DSModal
      open={order !== null}
      title={order ? `Assign technician - ${order.id}` : ''}
      onClose={onClose}
      width={620}
      trackScreen="Work orders > Assign technician window"
      footer={
        <>
          <DSButton variant="secondary" onClick={onClose}>
            Cancel
          </DSButton>
          <DSButton disabled={!chosen} onClick={onConfirm}>
            Assign and notify
          </DSButton>
        </>
      }
    >
      {order && (
        <div className="dsp-assign">
          <div className="dsp-assign__need">
            Needs <b>{order.skills.join(' + ')}</b> - about {order.estimateH} h - {order.site}
          </div>
          {ranked.map((t) => (
            <DSCard key={t.id} padding="small" selected={chosen === t.id} onClick={t.status === 'off' ? undefined : () => onChoose(t.id)} ariaLabel={`Choose ${t.name}`}>
              <div className={`dsp-tech${t.status === 'off' ? ' dsp-tech--off' : ''}`}>
                <DSAvatar name={t.name} size={40} tone={t.fits ? 'success' : 'neutral'} />
                <div className="dsp-tech__body">
                  <div className="dsp-tech__name">
                    {t.name}
                    {best && t.id === best.id && <DSBadge tone="success">Best match</DSBadge>}
                    <DSBadge tone={TECH_STATUS[t.status].tone}>{TECH_STATUS[t.status].label}</DSBadge>
                  </div>
                  <div className="dsp-cell-sub">
                    {t.match}/{order.skills.length} skills - {t.distanceKm} km away - {t.loadH} of 8 h booked
                  </div>
                  <DSProgress value={t.loadH} max={8} tone={t.loadH + order.estimateH > 8 ? 'danger' : 'accent'} label={`${t.name} workload`} />
                </div>
                {chosen === t.id && (
                  <span className="dsp-tech__check">
                    <DSIcon name="check-circle" />
                  </span>
                )}
              </div>
            </DSCard>
          ))}
        </div>
      )}
    </DSModal>
  );
}

// ---- Crew board -------------------------------------------------------------

function CrewBoard({ orders, onOpenOrder }: { orders: WorkOrder[]; onOpenOrder: (id: string) => void }) {
  return (
    <div className="dsp-crew" data-track-screen="Crew board > Board">
      <div className="dsp-head">
        <div>
          <h1 className="dsp-head__title">Crew board</h1>
          <div className="dsp-head__sub">{data.today} - who is doing what today</div>
        </div>
      </div>
      <div className="dsp-crew__grid">
        {TECHS.map((t) => {
          const jobs = orders.filter((o) => o.assignee === t.id && o.status !== 'done');
          const booked = jobs.reduce((s, o) => s + o.estimateH, 0) || t.loadH;
          return (
            <DSCard key={t.id} padding="medium">
              <div className="dsp-crew__col">
                <div className="dsp-crew__who">
                  <DSAvatar name={t.name} size={36} tone={t.status === 'off' ? 'neutral' : 'info'} />
                  <div className="dsp-crew__whotext">
                    <div className="dsp-cell-strong dsp-ellipsis">{t.name}</div>
                    <div className="dsp-cell-sub dsp-ellipsis">{t.base}</div>
                  </div>
                  <DSBadge tone={TECH_STATUS[t.status].tone}>{TECH_STATUS[t.status].label}</DSBadge>
                </div>
                <DSProgress value={Math.min(8, booked)} max={8} tone={booked >= 8 ? 'danger' : 'accent'} label={`${t.name} workload`} />
                <div className="dsp-cell-sub">{Math.min(8, booked)} of 8 h booked</div>
                <div className="dsp-crew__jobs">
                  {jobs.length === 0 && <div className="dsp-crew__none">No jobs yet</div>}
                  {jobs.map((o) => (
                    <DSCard key={o.id} padding="small" onClick={() => onOpenOrder(o.id)} ariaLabel={`Open ${o.id}`}>
                      <div className="dsp-crew__job">
                        <DSBadge tone={PRIORITY[o.priority].tone} dot>
                          {o.id}
                        </DSBadge>
                        <div className="dsp-ellipsis">{o.title}</div>
                        <div className="dsp-cell-sub">
                          {o.turbine} - {o.estimateH} h
                        </div>
                      </div>
                    </DSCard>
                  ))}
                </div>
              </div>
            </DSCard>
          );
        })}
      </div>
    </div>
  );
}
