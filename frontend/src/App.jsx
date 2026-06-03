import { useEffect, useState } from 'react';
import LogViewer from './components/LogViewer.jsx';
import './App.css';

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/auth/me')
      .then(r => (r.ok ? r.json() : null))
      .then(u => { setUser(u); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="splash">Loading…</div>;

  if (!user) {
    return (
      <div className="splash">
        <div className="splash-card">
          <h1>Okta Realm Log Viewer</h1>
          <p>Sign in with your Okta account to view logs for this realm.</p>
          <a href="/auth/login" className="btn-primary">Sign in with Okta</a>
        </div>
      </div>
    );
  }

  return (
    <div className="layout">
      <header className="topbar">
        <div className="topbar-left">
          <span className="topbar-logo">Okta Log Viewer</span>
          <span className="realm-badge">Realm: guoujfbwujYHeGy2Q1d7</span>
        </div>
        <div className="topbar-right">
          <span className="user-name">{user.name || user.email}</span>
          <a href="/auth/logout" className="btn-ghost">Sign out</a>
        </div>
      </header>
      <main className="main">
        <LogViewer access={user.access} />
      </main>
    </div>
  );
}
