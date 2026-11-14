import { useState, useEffect, useRef } from 'react';
import { BrowserRouter, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { api } from './api';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Assessments from './pages/Assessments';
import AssessmentDetail from './pages/AssessmentDetail';
import Approvals from './pages/Approvals';
import Audit from './pages/Audit';
import Learning from './pages/Learning';
import Reconcile from './pages/Reconcile';
import { Loading } from './components/ui';

// ─── design tokens (inline so shell is self-contained) ───────────────────────
const MS_BLUE = '#0078d4';
const MS_BLUE_LIGHT = '#deecf9';
const SIDEBAR_WIDTH = 220;

function usePendingCount(): number {
  const [count, setCount] = useState(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    api.approvals('pending').then((res) => {
      if (mounted.current) {
        setCount(res.items.length);
      }
    }).catch(() => { /* ignore */ });
    return () => { mounted.current = false; };
  }, []);
  return count;
}

// ─── Sidebar nav item ─────────────────────────────────────────────────────────
interface NavItemProps {
  to: string;
  icon: string;
  label: string;
  badge?: number;
}

function NavItem({ to, icon, label, badge }: NavItemProps) {
  const location = useLocation();
  const isActive = location.pathname === to || (to !== '/' && location.pathname.startsWith(to));

  const baseStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '0 12px',
    height: 40,
    borderRadius: 4,
    textDecoration: 'none',
    fontSize: 14,
    fontWeight: 400,
    color: isActive ? MS_BLUE : '#201f1e',
    background: isActive ? MS_BLUE_LIGHT : 'transparent',
    borderLeft: isActive ? `3px solid ${MS_BLUE}` : '3px solid transparent',
    transition: 'background 0.1s, color 0.1s',
    cursor: 'pointer',
    userSelect: 'none',
    position: 'relative',
  };

  return (
    <NavLink
      to={to}
      style={baseStyle}
      onMouseEnter={(e) => {
        if (!isActive) {
          (e.currentTarget as HTMLElement).style.background = '#f3f2f1';
        }
      }}
      onMouseLeave={(e) => {
        if (!isActive) {
          (e.currentTarget as HTMLElement).style.background = 'transparent';
        }
      }}
    >
      <span style={{ fontSize: 16, lineHeight: 1, flexShrink: 0 }}>{icon}</span>
      <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {label}
      </span>
      {badge != null && badge > 0 && (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: 18,
            height: 18,
            borderRadius: 9,
            background: '#c50f1f',
            color: '#fff',
            fontSize: 11,
            fontWeight: 600,
            padding: '0 4px',
            flexShrink: 0,
          }}
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </NavLink>
  );
}

// ─── Shell (authenticated layout) ─────────────────────────────────────────────
function Shell() {
  const { me, ready, signOut } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pendingCount = usePendingCount();

  if (!ready) return <Loading label="Loading AEGIS…" />;
  if (!me) return <Login />;

  const isAdmin = me.tokenRoles.includes('admin');
  const isApprover = me.tokenRoles.includes('approver');
  const displayName = me.name ?? me.oid;
  const roleBadge = isAdmin ? 'Admin' : isApprover ? 'Approver' : me.tokenRoles[0] ?? 'Viewer';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', fontFamily: 'Segoe UI, system-ui, -apple-system, sans-serif' }}>
      {/* Skip link */}
      <a
        href="#main"
        style={{
          position: 'absolute',
          left: -9999,
          top: 'auto',
          width: 1,
          height: 1,
          overflow: 'hidden',
        }}
        onFocus={(e) => {
          e.currentTarget.style.left = '8px';
          e.currentTarget.style.top = '8px';
          e.currentTarget.style.width = 'auto';
          e.currentTarget.style.height = 'auto';
          e.currentTarget.style.zIndex = '9999';
          e.currentTarget.style.padding = '8px 16px';
          e.currentTarget.style.background = '#fff';
          e.currentTarget.style.border = `2px solid ${MS_BLUE}`;
          e.currentTarget.style.borderRadius = '4px';
          e.currentTarget.style.textDecoration = 'none';
          e.currentTarget.style.color = MS_BLUE;
        }}
        onBlur={(e) => {
          e.currentTarget.style.left = '-9999px';
          e.currentTarget.style.width = '1px';
          e.currentTarget.style.height = '1px';
        }}
      >
        Skip to content
      </a>

      {/* ── Header ── */}
      <header
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: 48,
          zIndex: 200,
          background: MS_BLUE,
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          padding: '0 16px',
          gap: 12,
          boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
        }}
      >
        {/* Mobile hamburger */}
        <button
          aria-label={sidebarOpen ? 'Close navigation' : 'Open navigation'}
          onClick={() => setSidebarOpen((v) => !v)}
          style={{
            display: 'none',
            background: 'transparent',
            border: 'none',
            color: '#fff',
            fontSize: 20,
            cursor: 'pointer',
            padding: '4px 8px',
            borderRadius: 4,
          }}
          className="hamburger-btn"
        >
          ☰
        </button>

        {/* Logo + subtitle */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 20, letterSpacing: '-0.3px' }}>AEGIS</span>
          <span style={{ fontSize: 12, opacity: 0.85, fontWeight: 400 }}>Infrastructure Change Risk</span>
        </div>

        <div style={{ flex: 1 }} />

        {/* User info */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, opacity: 0.9 }}>{displayName}</span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              background: 'rgba(255,255,255,0.2)',
              border: '1px solid rgba(255,255,255,0.4)',
              borderRadius: 10,
              padding: '2px 8px',
              letterSpacing: '0.3px',
              textTransform: 'uppercase',
            }}
          >
            {roleBadge}
          </span>
          <button
            onClick={signOut}
            style={{
              background: 'rgba(255,255,255,0.15)',
              border: '1px solid rgba(255,255,255,0.4)',
              borderRadius: 4,
              color: '#fff',
              fontSize: 13,
              padding: '5px 12px',
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'background 0.1s',
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.25)')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.15)')}
          >
            Sign out
          </button>
        </div>
      </header>

      {/* ── Body (sidebar + content) ── */}
      <div style={{ display: 'flex', flex: 1, paddingTop: 48 }}>

        {/* Mobile overlay */}
        {sidebarOpen && (
          <div
            onClick={() => setSidebarOpen(false)}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 99,
              background: 'rgba(0,0,0,0.3)',
              display: 'none',
            }}
            className="sidebar-overlay"
          />
        )}

        {/* ── Sidebar ── */}
        <nav
          aria-label="Primary navigation"
          style={{
            position: 'fixed',
            top: 48,
            left: 0,
            bottom: 0,
            width: SIDEBAR_WIDTH,
            background: '#faf9f8',
            borderRight: '1px solid #edebe9',
            padding: '12px 8px',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            zIndex: 100,
            overflowY: 'auto',
            transition: 'transform 0.2s',
          }}
        >
          <NavItem to="/" icon="🏠" label="Dashboard" />
          <NavItem to="/assessments" icon="📋" label="Assessments" />
          <NavItem to="/approvals" icon="✅" label="Approvals" badge={pendingCount} />
          <NavItem to="/reconcile" icon="🔄" label="Drift & Reconcile" />
          {isAdmin && <NavItem to="/audit" icon="🔒" label="Audit & Compliance" />}
          {(isAdmin || isApprover) && <NavItem to="/learning" icon="📊" label="Learning Analytics" />}

          <div style={{ flex: 1 }} />

          {/* Version / footer area */}
          <div
            style={{
              fontSize: 11,
              color: '#a19f9d',
              padding: '8px 12px',
              borderTop: '1px solid #edebe9',
              marginTop: 8,
            }}
          >
            AEGIS v2.0
          </div>
        </nav>

        {/* ── Main content ── */}
        <main
          id="main"
          style={{
            flex: 1,
            marginLeft: SIDEBAR_WIDTH,
            minHeight: '100%',
            background: '#f3f2f1',
            padding: '24px 28px',
          }}
        >
          <div style={{ maxWidth: 1400, margin: '0 auto' }}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/assessments" element={<Assessments />} />
              <Route path="/assessments/:id" element={<AssessmentDetail />} />
              <Route path="/approvals" element={<Approvals />} />
              <Route path="/reconcile" element={<Reconcile />} />
              <Route
                path="/audit"
                element={isAdmin ? <Audit /> : <Navigate to="/" replace />}
              />
              <Route
                path="/learning"
                element={
                  isAdmin || isApprover ? <Learning /> : <Navigate to="/" replace />
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </main>
      </div>

      {/* ── Responsive CSS ── */}
      <style>{`
        @media (max-width: 768px) {
          .hamburger-btn { display: block !important; }
          nav[aria-label="Primary navigation"] {
            transform: ${sidebarOpen ? 'translateX(0)' : `translateX(-${SIDEBAR_WIDTH}px)`} !important;
          }
          main#main {
            margin-left: 0 !important;
          }
          .sidebar-overlay { display: block !important; }
        }
      `}</style>
    </div>
  );
}

// ─── App root ─────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </BrowserRouter>
  );
}
