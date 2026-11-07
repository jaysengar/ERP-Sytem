import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { StoreProvider, useStore } from './data/Store';
import { Layout } from './components/Layout';
import { Empty } from './components/ui';
import type { Permission } from './domain/types';
import { can } from './domain/types';
import type { ReactNode } from 'react';
import './styles.css';
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Products = lazy(() => import('./pages/Products'));
const POS = lazy(() => import('./pages/POS'));
const Purchases = lazy(() => import('./pages/Purchases'));
const Sales = lazy(() => import('./pages/Sales'));
const Customers = lazy(() => import('./pages/Customers'));
const Expenses = lazy(() => import('./pages/Expenses'));
const Reports = lazy(() => import('./pages/Reports'));
const Staff = lazy(() => import('./pages/Staff'));
const Settings = lazy(() => import('./pages/Settings'));
function Access({ action, children }: { action: Permission; children: ReactNode }) { const { role } = useStore(); return can(role, action) ? children : <><h1>Owner access required</h1><Empty title="This page is restricted for your demo role" description={`You are viewing the store as ${role}. Change your preview role on the Staff & access page.`} action={<Link className="btn primary" to="/staff">View demo roles</Link>} /></>; }
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <StoreProvider>
        <Suspense fallback={<div className="loading-screen" role="status"><div className="skeleton" /><p>Opening your workspace…</p></div>}>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Dashboard />} />
              <Route path="products" element={<Products />} />
              <Route path="inventory" element={<Products inventory />} />
              <Route path="pos" element={<Access action="sell"><POS /></Access>} />
              <Route path="purchases" element={<Access action="purchase"><Purchases /></Access>} />
              <Route path="sales" element={<Sales />} />
              <Route path="customers" element={<Customers />} />
              <Route path="expenses" element={<Access action="expenses"><Expenses /></Access>} />
              <Route path="reports" element={<Access action="reports"><Reports /></Access>} />
              <Route path="staff" element={<Staff />} />
              <Route path="settings" element={<Access action="settings"><Settings /></Access>} />
              <Route path="*" element={<Empty title="Page not found" description="Return to your store dashboard to continue." action={<Link to="/" className="btn primary">Open dashboard</Link>} />} />
            </Route>
          </Routes>
        </Suspense>
      </StoreProvider>
    </BrowserRouter>
  </StrictMode>,
);
