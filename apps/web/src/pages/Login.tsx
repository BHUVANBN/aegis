import { useState, type FormEvent } from 'react';
import { AUTH_MODE, resetSignInState, useAuth } from '../auth';
import { Field, Notice } from '../components/ui';

export default function Login() {
  const { signIn, error } = useAuth();
  const [identity, setIdentity] = useState('alice');
  const [roles, setRoles] = useState('assessor');
  const [busy, setBusy] = useState(false);
  const go = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    try {
      await signIn(identity, roles);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login card">
      <h1 id="page-title" tabIndex={-1}>
        AEGIS
      </h1>
      <p className="lead">Infrastructure change risk: assess, approve and verify changes before and after they reach Azure.</p>
      {error && (
        <Notice tone="error" title="Sign-in did not finish">
          {error}
        </Notice>
      )}
      {AUTH_MODE === 'dev' ? (
        <form onSubmit={(e) => void go(e)}>
          <Notice tone="warn">Development sign-in. It exists only in builds made for local testing.</Notice>
          <Field id="dev-id" label="Identity">
            <input id="dev-id" value={identity} onChange={(e) => setIdentity(e.target.value)} />
          </Field>
          <Field id="dev-roles" label="Roles (comma separated)">
            <input id="dev-roles" value={roles} onChange={(e) => setRoles(e.target.value)} />
          </Field>
          <button type="submit" disabled={busy}>
            Sign in
          </button>
        </form>
      ) : (
        <>
          <p>You will be taken to Microsoft to sign in, then returned here.</p>
          <button type="button" disabled={busy} onClick={() => void go()}>
            {busy ? 'Opening Microsoft sign-in…' : 'Sign in with Microsoft'}
          </button>
        </>
      )}
      <details className="help">
        <summary>Trouble signing in?</summary>
        <ul className="plain">
          <li>If nothing happens, or you see an &ldquo;interaction in progress&rdquo; message, reset the sign-in and try again.</li>
          <li>
            A message that you lack permission means an administrator still has to give you an app role and environment access. Sign in once,
            then send them your details.
          </li>
          <li>Repeated verification prompts: use a private window and your normal browser sign-in.</li>
        </ul>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            resetSignInState();
            window.location.reload();
          }}
        >
          Reset sign-in
        </button>
      </details>
    </div>
  );
}
