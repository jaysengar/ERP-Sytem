import { Suspense, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Package, ScanLine, Boxes, Truck, ReceiptText, Users, Wallet, ChartNoAxesCombined, ShieldCheck, Settings, Store, Bell, Search, ChevronDown, Menu, X, ArrowUpRight, ArrowRight, CircleHelp, ShoppingBag } from 'lucide-react';
import { useStore } from '../data/Store';
import { can } from '../domain/types';
import { ChangePassword } from './ChangePassword';
import { Badge, Dialog, Empty, ProductThumb } from './ui';

const nav = [
  ['/', 'Dashboard', LayoutDashboard],
  ['/products', 'Products', Package],
  ['/pos', 'POS Billing', ScanLine],
  ['/inventory', 'Inventory', Boxes],
  ['/purchases', 'Purchases', Truck],
  ['/sales', 'Sales history', ReceiptText],
  ['/customers', 'Customers', Users],
  ['/expenses', 'Expenses', Wallet],
  ['/reports', 'Reports & analytics', ChartNoAxesCombined],
] as const;
const tour = [
  ['Dashboard', '/', 'Start with today’s sales and stock alerts.'],
  ['Products', '/products', 'Find a style by name, SKU or barcode.'],
  ['POS Billing', '/pos', 'Add items, review the bill and complete a sale.'],
  ['Inventory', '/inventory', 'See stock deducted automatically.'],
  ['Purchases', '/purchases', 'Receive an order to replenish stock.'],
  ['Customers', '/customers', 'Look up a customer’s purchase history.'],
  ['Reports', '/reports', 'Understand sales, costs and stock.'],
];

export function Layout() {
  const { db, role, user, workspace, connected, logout, refresh, toast } = useStore();
  const [password, setPassword] = useState(false);
  const [menu, setMenu] = useState(false);
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 1050px)').matches);
  const [notifications, setNotifications] = useState(false);
  const [guide, setGuide] = useState(false);
  const [profile, setProfile] = useState(false);
  const [query, setQuery] = useState('');
  const location = useLocation();
  const navigate = useNavigate();
  const search = useRef<HTMLInputElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const low = db.products.filter(p => p.quantity <= p.minStock);
  const pageName = nav.find(([path]) => path === location.pathname)?.[1]
    || (location.pathname === '/staff' ? 'Staff & access' : location.pathname === '/settings' ? 'Settings' : location.pathname === '/billing' ? 'Billing' : 'Store');

  useEffect(() => {
    const media = window.matchMedia('(max-width: 1050px)');
    const change = () => { setMobile(media.matches); if (!media.matches) setMenu(false); };
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);

  useEffect(() => {
    setMenu(false);
    document.title = `${pageName} · Smart Retail`;
    const frame = requestAnimationFrame(() => document.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true }));
    window.scrollTo(0, 0);
    return () => cancelAnimationFrame(frame);
  }, [location.pathname, pageName]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k' && !document.querySelector('dialog[open]') && !menu) {
        e.preventDefault(); search.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [menu]);

  useEffect(() => {
    if (!mobile || !menu) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const first = sidebar.current?.querySelector<HTMLElement>('.mobile-close');
    first?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); setMenu(false); return; }
      if (e.key !== 'Tab') return;
      const items = [...(sidebar.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') || [])].filter(el => el.getClientRects().length > 0);
      const firstItem = items[0]; const lastItem = items.at(-1);
      if (e.shiftKey && document.activeElement === firstItem) { e.preventDefault(); lastItem?.focus(); }
      else if (!e.shiftKey && document.activeElement === lastItem) { e.preventDefault(); firstItem?.focus(); }
    };
    document.addEventListener('keydown', trap);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', trap);
      menuButton.current?.focus({ preventScroll: true });
    };
  }, [mobile, menu]);

  return (
    <>
      <a href="#main" className="skip-link">Skip to content</a>
      {menu && mobile && <button className="sidebar-scrim" tabIndex={-1} aria-label="Close navigation" onClick={() => setMenu(false)} />}
      <aside ref={sidebar} id="store-navigation" className={`sidebar ${menu ? 'open' : ''}`} aria-label="Main navigation" role={mobile ? 'dialog' : undefined} aria-modal={mobile && menu ? true : undefined} aria-hidden={mobile && !menu ? true : undefined} inert={mobile && !menu}>
        <NavLink to="/" className="brand"><span className="brand-mark"><ShoppingBag size={23} strokeWidth={1.8} aria-hidden="true" /></span><span>smart<span className="brand-light">retail</span><small>YOUR STORE, CONNECTED</small></span></NavLink>
        <button className="mobile-close icon-btn" aria-label="Close navigation" onClick={() => setMenu(false)}><X size={20} /></button>
        <div className="store-switch"><span className="store-icon"><Store size={18} aria-hidden="true" /></span><div><strong>{db.settings.shopName}</strong><small>Single store</small></div><Badge tone="green">Open</Badge></div>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Store pages">
          {nav.map(([path, title, Icon]) => <NavLink key={path} to={path} end={path === '/'} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><Icon size={19} strokeWidth={1.7} aria-hidden="true" /><span>{title}</span>{path === '/inventory' && low.length > 0 && <span className="nav-count">{low.length}</span>}</NavLink>)}
          <div className="nav-divider" />
          <NavLink to="/staff" className="nav-item"><ShieldCheck size={19} aria-hidden="true" />Staff & access</NavLink>
          <NavLink to="/settings" className="nav-item"><Settings size={19} aria-hidden="true" />Settings</NavLink>
          {can(role, 'settings') && <NavLink to="/billing" className="nav-item"><ReceiptText size={19} aria-hidden="true" />Billing & subscription</NavLink>}
        </nav>
        <div className="sidebar-bottom">
          <button className="help-btn" onClick={() => { setMenu(false); setGuide(true); }}><CircleHelp size={18} aria-hidden="true" /><span>Take a quick tour</span><ArrowUpRight size={15} aria-hidden="true" /></button>
          <div className="demo-note"><span className="demo-dot" /><div><strong>Store workspace</strong><small>One shared store database.</small></div></div>
        </div>
      </aside>
      <div className="workspace" inert={mobile && menu}>
        <header className="topbar">
          <div className="topbar-left"><button ref={menuButton} className="icon-btn menu-toggle" aria-label="Open navigation" aria-controls="store-navigation" aria-expanded={menu} onClick={() => setMenu(true)}><Menu size={22} /></button><span className="store-breadcrumb"><Store size={16} aria-hidden="true" />{db.settings.shopName}<span>/</span><strong>{pageName}</strong></span></div>
          <form className="global-search" role="search" onSubmit={e => { e.preventDefault(); navigate(`/products?search=${encodeURIComponent(query)}`); }}><Search size={17} aria-hidden="true" /><input ref={search} aria-label="Search all products" placeholder="Search products…" value={query} onChange={e => setQuery(e.target.value)} /><kbd aria-hidden="true">Ctrl K</kbd><button type="submit" aria-label="Search products"><ArrowRight size={17} /></button></form>
          <div className="topbar-right">
            <span className="top-demo">{connected ? 'Connected' : 'Offline'}</span>
            <button className="icon-btn notification-btn" aria-label={`${low.length} stock alerts`} onClick={() => setNotifications(true)}><Bell size={20} />{low.length > 0 && <span />}</button>
            <span className="top-separator" />
            <button className="profile-btn" aria-label="Open profile menu" aria-haspopup="dialog" onClick={() => setProfile(true)}><span className="avatar">{user.name.split(' ').map(n => n[0]).slice(0, 2).join('')}</span><span><strong>{user.name}</strong><small>{role}</small></span><ChevronDown size={15} aria-hidden="true" /></button>
          </div>
        </header>
        {!connected && <div className="connection-warning" role="alert"><span>Connection interrupted. Reconnect before recording your next sale.</span><button className="btn small" onClick={() => void refresh().catch(e => toast(e.message, true))}>Reconnect</button></div>}
        {workspace && !workspace.canWrite && <div className="connection-warning" role="status"><span>Your subscription needs attention. Existing records are available; new changes are paused.</span>{can(role, 'settings') && <NavLink to="/billing" className="btn small">Manage subscription</NavLink>}</div>}
        <main id="main" className="main-content" tabIndex={-1}>
          <Suspense fallback={<div className="route-loading" role="status" aria-label="Loading page"><div className="skeleton" /><div className="skeleton" /><span>Opening your workspace…</span></div>}><Outlet /></Suspense>
        </main>
        <footer className="app-footer"><span>Smart Retail · Made for your everyday business</span><span><span className="saved-dot" /> {connected ? 'Connected to store server' : 'Connection interrupted'}</span></footer>
      </div>
      {profile && <Dialog title="Your workspace" onClose={() => setProfile(false)}><div className="profile-summary"><span className="avatar">{user.name.split(' ').map(n => n[0]).slice(0, 2).join('')}</span><div><strong>{user.name}</strong><p>{user.email}</p><Badge tone="blue">{role}</Badge></div></div><div className="profile-actions">{can(role, 'settings') && <button className="btn" onClick={() => { setProfile(false); navigate('/settings'); }}><Settings size={17} />Shop & profile settings<ArrowRight size={17} /></button>}<button className="btn" onClick={() => { setProfile(false); navigate('/staff'); }}><ShieldCheck size={17} />Staff & permissions<ArrowRight size={17} /></button><button className="btn" onClick={() => { setProfile(false); setPassword(true); }}>Change password</button><button className="btn" onClick={() => void logout()}>Sign out</button></div></Dialog>}
      {password && <ChangePassword onClose={() => setPassword(false)} />}
      {notifications && <Dialog title="Stock alerts" onClose={() => setNotifications(false)}><p className="muted">{low.length} variants need your attention.</p><div className="alert-list">{low.slice(0, 8).map(p => <button key={p.id} onClick={() => { setNotifications(false); navigate(`/inventory?search=${p.sku}`); }}><ProductThumb product={p} /><span><strong>{p.name}</strong><small>{p.size} · {p.colour}</small></span><Badge tone={p.quantity ? 'amber' : 'red'}>{p.quantity} left</Badge></button>)}</div>{!low.length && <Empty title="Stock looks healthy" description="All products are above their minimum levels." />}<button className="btn full" onClick={() => { setNotifications(false); navigate('/inventory?stock=Low+stock'); }}>View inventory</button></Dialog>}
      {guide && <Dialog title="A day in your store" onClose={() => setGuide(false)}><p className="muted">Follow the journey from your first bill to your business report. Changes are saved to the shared store database.</p><ol className="tour-steps">{tour.map(([title, path, description]) => <li key={path}><button onClick={() => { setGuide(false); navigate(path); }}><strong>{title}</strong><span>{description}</span><ArrowUpRight size={17} aria-hidden="true" /></button></li>)}</ol></Dialog>}
    </>
  );
}
