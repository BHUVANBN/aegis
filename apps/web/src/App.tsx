import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { Loading, Notice } from './components/ui';
import Approvals from './pages/Approvals';
import AssessmentDetail from './pages/AssessmentDetail';
import Assessments from './pages/Assessments';
import Audit from './pages/Audit';
import Guide from './pages/Guide';
import Learning from './pages/Learning';
import Login from './pages/Login';
import Operations from './pages/Operations';
import Overview from './pages/Overview';
import Reconcile from './pages/Reconcile';
import Settings from './pages/Settings';
import Setup from './pages/Setup';

function Guard({ roles, children }: { roles: string[]; children: ReactNode }) {
  const { me } = useAuth();
  if (me && roles.some((r) => me.tokenRoles.includes(r))) return <>{children}</>;
  return (
    <>
      <h1 id="page-title" tabIndex={-1}>
        Not available to your role
      </h1>
      <Notice tone="info">This page needs one of these roles: {roles.join(', ')}. Ask an administrator if you need it.</Notice>
    </>
  );
}

/** After a page change, move focus to the page heading so keyboard and screen-reader users start at the top. */
function RouteFocus() {
  const loc = useLocation();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (loc.hash) return;
    const t = window.setTimeout(() => {
      (document.getElementById('page-title') ?? document.getElementById('main'))?.focus();
      window.scrollTo(0, 0);
    }, 60);
    return () => window.clearTimeout(t);
  }, [loc.pathname]);
  return null;
}

function Shell() {
  const { me, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  const roles = me?.tokenRoles ?? [];
  const has = (...r: string[]) => r.some((x) => roles.includes(x));

  const groups: { title: string; links: { to: string; label: string; show: boolean }[] }[] = [
    {
      title: 'Insights',
      links: [
        { to: '/overview', label: 'Business value', show: true },
        { to: '/operations', label: 'Operations', show: has('admin', 'approver') },
      ],
    },
    {
      title: 'Changes',
      links: [
        { to: '/assessments', label: 'Assessments', show: true },
        { to: '/approvals', label: 'Approvals', show: true },
      ],
    },
    {
      title: 'Governance',
      links: [
        { to: '/reconcile', label: 'Drift checks', show: has('admin', 'approver') },
        { to: '/audit', label: 'Audit trail', show: has('admin') },
        { to: '/learning', label: 'Learning', show: has('admin', 'approver') },
      ],
    },
    { title: 'Administer', links: [{ to: '/setup', label: 'Setup', show: has('admin') }] },
    {
      title: 'Help',
      links: [
        { to: '/guide', label: 'Guide', show: true },
        { to: '/settings', label: 'Settings', show: true },
      ],
    },
  ];

  return (
    <div className="app">
      <a href="#main" className="skip-link">
        Skip to main content
      </a>
      <header className="topbar">
        <button type="button" className="secondary menu-btn" aria-expanded={open} aria-controls="sidenav" onClick={() => setOpen(!open)}>
          Menu
        </button>
        <span className="brand">AEGIS</span>
        <span className="tagline">Infrastructure change risk</span>
        <span className="spacer" />
        <span className="who">
          <span className="who-name">{me?.name ?? me?.oid.slice(0, 8)}</span>
          <span className="who-roles">{roles.join(', ') || 'no roles'}</span>
        </span>
        <button type="button" className="secondary" onClick={signOut}>
          Sign out
        </button>
      </header>
      <nav id="sidenav" className={`sidenav${open ? ' open' : ''}`} aria-label="Main">
        {groups.map((g) => {
          const links = g.links.filter((l) => l.show);
          if (links.length === 0) return null;
          return (
            <div key={g.title} className="nav-group">
              <p className="nav-title">{g.title}</p>
              <ul>
                {links.map((l) => (
                  <li key={l.to}>
                    <NavLink to={l.to}>{l.label}</NavLink>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>
      <main id="main" tabIndex={-1}>
        <RouteFocus />
        <Routes>
          <Route path="/" element={<Navigate to="/overview" replace />} />
          <Route path="/overview" element={<Overview />} />
          <Route path="/operations" element={<Guard roles={['admin', 'approver']}><Operations /></Guard>} />
          <Route path="/assessments" element={<Assessments />} />
          <Route path="/assessments/:id" element={<AssessmentDetail />} />
          <Route path="/approvals" element={<Approvals />} />
          <Route path="/reconcile" element={<Guard roles={['admin', 'approver']}><Reconcile /></Guard>} />
          <Route path="/audit" element={<Guard roles={['admin']}><Audit /></Guard>} />
          <Route path="/learning" element={<Guard roles={['admin', 'approver']}><Learning /></Guard>} />
          <Route path="/setup" element={<Setup />} />
          <Route path="/guide" element={<Guide />} />
          <Route path="/settings" element={<Settings />} />
          <Route
            path="*"
            element={
              <>
                <h1 id="page-title" tabIndex={-1}>
                  Page not found
                </h1>
                <p>
                  Try the <NavLink to="/overview">business value page</NavLink>.
                </p>
              </>
            }
          />
        </Routes>
      </main>
      <footer className="footer">
        Measured numbers come from the AEGIS database; estimates are labelled and use assumptions you control. AEGIS judges infrastructure changes
        only.
      </footer>
    </div>
  );
}

function Gate() {
  const { me, ready } = useAuth();
  if (!ready)
    return (
      <main id="main" className="center">
        <Loading label="Starting AEGIS" />
      </main>
    );
  if (!me)
    return (
      <div className="app app-login">
        <a href="#main" className="skip-link">
          Skip to main content
        </a>
        <main id="main" tabIndex={-1} className="center">
          <Login />
        </main>
      </div>
    );
  return <Shell />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </BrowserRouter>
  );
}
