import { useState, type FormEvent } from 'react';
import { AUTH_MODE, useAuth } from '../auth';
import { ErrorBox } from '../components/ui';

const MS_BLUE = '#0078d4';
const MS_BLUE_DARK = '#005a9e';

const DEV_USERS = [
  { id: 'alice@example.test', roles: 'assessor,viewer', label: 'Alice (assessor)' },
  { id: 'bob@example.test', roles: 'approver,viewer', label: 'Bob (approver)' },
  { id: 'carol@example.test', roles: 'admin,viewer', label: 'Carol (admin)' },
];

export default function Login() {
  const { signIn, error } = useAuth();
  const [who, setWho] = useState(DEV_USERS[0]!.id);
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const u = DEV_USERS.find((d) => d.id === who)!;
    await signIn(u.id, u.roles);
    setLoading(false);
  };

  const handleMsSignIn = async () => {
    setLoading(true);
    await signIn();
    setLoading(false);
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#f3f2f1',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'Segoe UI, system-ui, -apple-system, sans-serif',
        padding: '24px 16px',
      }}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: 6,
          boxShadow: '0 3.2px 7.2px 0 rgba(0,0,0,.13),0 0.6px 1.8px 0 rgba(0,0,0,.11)',
          padding: '48px 40px 36px',
          width: '100%',
          maxWidth: 400,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 0,
        }}
      >
        {/* Logo mark */}
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: 12,
            background: MS_BLUE,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 20,
            boxShadow: '0 2px 8px rgba(0,120,212,0.35)',
          }}
        >
          <span style={{ fontSize: 28, color: '#fff', fontWeight: 800, letterSpacing: '-1px' }}>Æ</span>
        </div>

        {/* Title */}
        <h1
          style={{
            margin: '0 0 6px',
            fontSize: 28,
            fontWeight: 700,
            color: '#201f1e',
            letterSpacing: '-0.5px',
            textAlign: 'center',
          }}
        >
          AEGIS
        </h1>

        {/* Subtitle */}
        <p
          style={{
            margin: '0 0 32px',
            fontSize: 14,
            color: '#605e5c',
            textAlign: 'center',
            lineHeight: 1.5,
          }}
        >
          Agentic infrastructure change risk detection
          <br />
          for Azure environments
        </p>

        {/* Error */}
        {error && <ErrorBox error={new Error(error)} />}

        {/* Sign-in area */}
        {AUTH_MODE === 'dev' ? (
          <form
            onSubmit={submit}
            style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}
          >
            {/* Dev warning */}
            <div
              role="note"
              style={{
                background: '#fff4ce',
                border: '1px solid #ca5010',
                borderRadius: 4,
                padding: '10px 14px',
                fontSize: 12,
                color: '#603d00',
                lineHeight: 1.5,
              }}
            >
              ⚠️ <strong>Development sign-in only.</strong> Not available in production.
            </div>

            <label
              htmlFor="dev-user"
              style={{ fontSize: 13, fontWeight: 600, color: '#201f1e' }}
            >
              Sign in as
            </label>
            <select
              id="dev-user"
              value={who}
              onChange={(e) => setWho(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 10px',
                border: '1px solid #c8c6c4',
                borderRadius: 4,
                fontSize: 14,
                color: '#201f1e',
                background: '#fff',
                fontFamily: 'inherit',
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              {DEV_USERS.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                height: 40,
                marginTop: 4,
                background: loading ? '#c8c6c4' : MS_BLUE,
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                fontSize: 14,
                fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
                transition: 'background 0.1s',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
              onMouseEnter={(e) => {
                if (!loading) (e.currentTarget as HTMLElement).style.background = MS_BLUE_DARK;
              }}
              onMouseLeave={(e) => {
                if (!loading) (e.currentTarget as HTMLElement).style.background = MS_BLUE;
              }}
            >
              {loading ? '⏳ Signing in…' : '🪟 Sign in (Dev)'}
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={handleMsSignIn}
            disabled={loading}
            style={{
              width: '100%',
              height: 44,
              background: loading ? '#c8c6c4' : MS_BLUE,
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              fontSize: 15,
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
              transition: 'background 0.1s',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              letterSpacing: '0.1px',
            }}
            onMouseEnter={(e) => {
              if (!loading) (e.currentTarget as HTMLElement).style.background = MS_BLUE_DARK;
            }}
            onMouseLeave={(e) => {
              if (!loading) (e.currentTarget as HTMLElement).style.background = MS_BLUE;
            }}
          >
            <span style={{ fontSize: 18, lineHeight: 1 }}>🪟</span>
            {loading ? 'Redirecting…' : 'Sign in with Microsoft'}
          </button>
        )}

        {/* Disclaimer */}
        <p
          style={{
            margin: '28px 0 0',
            fontSize: 11,
            color: '#a19f9d',
            textAlign: 'center',
            lineHeight: 1.6,
            borderTop: '1px solid #edebe9',
            paddingTop: 20,
            width: '100%',
          }}
        >
          By signing in you agree to your organization's acceptable use policies.
          AEGIS records an immutable audit trail of all actions.
          Unauthorized access attempts are logged.
        </p>
      </div>
    </div>
  );
}
