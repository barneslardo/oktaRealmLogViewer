import { useCallback, useEffect, useRef, useState } from 'react';
import { formatDistanceToNow, parseISO, format } from 'date-fns';
import LogDetail from './LogDetail.jsx';
import './LogViewer.css';

const SEVERITY_CLASS = {
  DEBUG: 'sev-debug',
  INFO: 'sev-info',
  WARN: 'sev-warn',
  ERROR: 'sev-error',
};

export default function LogViewer({ access }) {
  const isGlobal = access?.role === 'global';
  const realmLabels = access?.realmLabels ?? [];

  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [nextCursor, setNextCursor] = useState(null);
  const [selectedLog, setSelectedLog] = useState(null);
  const [eventTypes, setEventTypes] = useState([]);

  // For global admins: which realm to scope to ('' = all)
  const [selectedRealm, setSelectedRealm] = useState('');

  const [filters, setFilters] = useState({
    since: '',
    until: '',
    eventType: '',
    q: '',
  });

  const [autoRefresh, setAutoRefresh] = useState(false);
  const timerRef = useRef(null);

  const fetchLogs = useCallback(async (cursor = null, append = false) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (filters.since) params.set('since', new Date(filters.since).toISOString());
      if (filters.until) params.set('until', new Date(filters.until).toISOString());
      if (filters.eventType) params.set('eventType', filters.eventType);
      if (filters.q) params.set('q', filters.q);
      if (isGlobal && selectedRealm) params.set('realmId', selectedRealm);
      if (cursor) params.set('after', cursor);

      const res = await fetch(`/api/logs?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { logs: newLogs, nextCursor: nc } = await res.json();

      setLogs(prev => append ? [...prev, ...newLogs] : newLogs);
      setNextCursor(nc);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [filters, selectedRealm, isGlobal]);

  // Reload event types when realm scope changes
  useEffect(() => {
    const params = new URLSearchParams();
    if (isGlobal && selectedRealm) params.set('realmId', selectedRealm);
    fetch(`/api/logs/event-types?${params.toString()}`)
      .then(r => r.json())
      .then(setEventTypes)
      .catch(() => {});
  }, [selectedRealm, isGlobal]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  useEffect(() => {
    if (autoRefresh) {
      timerRef.current = setInterval(() => fetchLogs(), 30000);
    }
    return () => clearInterval(timerRef.current);
  }, [autoRefresh, fetchLogs]);

  const handleFilterChange = e => {
    const { name, value } = e.target;
    setFilters(prev => ({ ...prev, [name]: value }));
  };

  const handleSearch = e => { e.preventDefault(); fetchLogs(); };
  const handleClear = () => setFilters({ since: '', until: '', eventType: '', q: '' });

  // Label shown in the header for current realm scope
  const scopeLabel = isGlobal
    ? (selectedRealm
        ? realmLabels.find(r => r.id === selectedRealm)?.name || selectedRealm
        : 'All Realms')
    : realmLabels.map(r => r.name).join(', ');

  return (
    <div className="log-viewer">
      <div className="scope-bar">
        <div className="scope-info">
          <span className={`role-badge ${isGlobal ? 'role-global' : 'role-realm'}`}>
            {isGlobal ? 'Global Admin' : 'Realm Admin'}
          </span>
          <span className="scope-label">
            Viewing: <strong>{scopeLabel}</strong>
          </span>
        </div>

        {isGlobal && (
          <div className="realm-selector">
            <label htmlFor="realm-select">Realm</label>
            <select
              id="realm-select"
              value={selectedRealm}
              onChange={e => { setSelectedRealm(e.target.value); setFilters(f => ({ ...f, eventType: '' })); }}
            >
              <option value="">All Realms</option>
              {realmLabels.map(r => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="toolbar">
        <form className="filters" onSubmit={handleSearch}>
          <input
            type="text"
            name="q"
            placeholder="Search logs…"
            value={filters.q}
            onChange={handleFilterChange}
          />
          <select name="eventType" value={filters.eventType} onChange={handleFilterChange}>
            <option value="">All event types</option>
            {eventTypes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <input
            type="datetime-local"
            name="since"
            title="Since"
            value={filters.since}
            onChange={handleFilterChange}
          />
          <input
            type="datetime-local"
            name="until"
            title="Until"
            value={filters.until}
            onChange={handleFilterChange}
          />
          <button type="submit" className="btn-accent" disabled={loading}>
            {loading ? 'Loading…' : 'Search'}
          </button>
          <button type="button" className="btn-secondary" onClick={handleClear}>Clear</button>
        </form>
        <div className="toolbar-right">
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={e => setAutoRefresh(e.target.checked)}
            />
            Auto-refresh
          </label>
          <button className="btn-secondary" onClick={() => fetchLogs()} disabled={loading}>
            ↻ Refresh
          </button>
        </div>
      </div>

      {error && <div className="error-banner">Error: {error}</div>}

      <div className="log-count">
        {logs.length > 0 && <span>{logs.length} event{logs.length !== 1 ? 's' : ''}</span>}
      </div>

      <div className="log-table-wrap">
        <table className="log-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Severity</th>
              <th>Event Type</th>
              <th>Actor</th>
              <th>Target</th>
              <th>Outcome</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 && !loading && (
              <tr><td colSpan={6} className="empty">No events found</td></tr>
            )}
            {logs.map(log => (
              <tr
                key={log.uuid}
                className={`log-row ${selectedLog?.uuid === log.uuid ? 'selected' : ''}`}
                onClick={() => setSelectedLog(selectedLog?.uuid === log.uuid ? null : log)}
              >
                <td className="col-time" title={log.published}>
                  <span className="time-rel">{formatDistanceToNow(parseISO(log.published), { addSuffix: true })}</span>
                  <span className="time-abs">{format(parseISO(log.published), 'MMM d HH:mm:ss')}</span>
                </td>
                <td>
                  <span className={`badge ${SEVERITY_CLASS[log.severity] || 'sev-info'}`}>
                    {log.severity}
                  </span>
                </td>
                <td className="col-event">{log.eventType}</td>
                <td className="col-actor">{log.actor?.displayName || log.actor?.alternateId || '—'}</td>
                <td className="col-target">
                  {log.target?.length ? log.target[0].displayName || log.target[0].alternateId : '—'}
                </td>
                <td>
                  <span className={`badge ${log.outcome?.result === 'SUCCESS' ? 'sev-success' : log.outcome?.result === 'FAILURE' ? 'sev-error' : 'sev-debug'}`}>
                    {log.outcome?.result || '—'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {nextCursor && (
        <div className="load-more">
          <button className="btn-secondary" onClick={() => fetchLogs(nextCursor, true)} disabled={loading}>
            {loading ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}

      {selectedLog && (
        <LogDetail log={selectedLog} onClose={() => setSelectedLog(null)} />
      )}
    </div>
  );
}
