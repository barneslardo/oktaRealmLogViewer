import { format, parseISO } from 'date-fns';
import './LogDetail.css';

export default function LogDetail({ log, onClose }) {
  return (
    <div className="detail-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="detail-panel">
        <div className="detail-header">
          <div>
            <div className="detail-title">{log.eventType}</div>
            <div className="detail-time">
              {format(parseISO(log.published), "PPP 'at' HH:mm:ss.SSS zzz")}
            </div>
          </div>
          <button className="detail-close" onClick={onClose}>✕</button>
        </div>

        <div className="detail-body">
          <Section title="Summary">
            <Field label="Display Message" value={log.displayMessage} />
            <Field label="Severity" value={log.severity} />
            <Field label="UUID" value={log.uuid} mono />
          </Section>

          {log.outcome && (
            <Section title="Outcome">
              <Field label="Result" value={log.outcome.result} />
              {log.outcome.reason && <Field label="Reason" value={log.outcome.reason} />}
            </Section>
          )}

          {log.actor && (
            <Section title="Actor">
              <Field label="Display Name" value={log.actor.displayName} />
              <Field label="Alternate ID" value={log.actor.alternateId} mono />
              <Field label="Type" value={log.actor.type} />
            </Section>
          )}

          {log.client && (
            <Section title="Client">
              <Field label="IP" value={log.client.ipAddress} mono />
              <Field label="User Agent" value={log.client.userAgent?.rawUserAgent} />
              <Field label="Zone" value={log.client.zone} />
              <Field label="Device" value={log.client.device} />
              {log.client.geographicalContext && (
                <Field
                  label="Location"
                  value={[
                    log.client.geographicalContext.city,
                    log.client.geographicalContext.state,
                    log.client.geographicalContext.country,
                  ].filter(Boolean).join(', ')}
                />
              )}
            </Section>
          )}

          {log.target?.length > 0 && (
            <Section title={`Targets (${log.target.length})`}>
              {log.target.map((t, i) => (
                <div key={i} className="target-item">
                  <Field label="Type" value={t.type} />
                  <Field label="ID" value={t.id} mono />
                  <Field label="Display Name" value={t.displayName} />
                  {t.alternateId && <Field label="Alternate ID" value={t.alternateId} mono />}
                </div>
              ))}
            </Section>
          )}

          {log.authenticationContext && (
            <Section title="Authentication Context">
              <Field label="Auth Step" value={log.authenticationContext.authenticationStep?.toString()} />
              <Field label="External Session ID" value={log.authenticationContext.externalSessionId} mono />
              <Field label="Credential Type" value={log.authenticationContext.credentialType} />
              <Field label="Issuer" value={log.authenticationContext.issuer?.[0]?.id} mono />
            </Section>
          )}

          {log.securityContext && (
            <Section title="Security Context">
              <Field label="AS Number" value={log.securityContext.asNumber?.toString()} />
              <Field label="AS Org" value={log.securityContext.asOrg} />
              <Field label="ISP" value={log.securityContext.isp} />
              <Field label="Domain" value={log.securityContext.domain} mono />
              <Field label="Is Proxy" value={log.securityContext.isProxy?.toString()} />
            </Section>
          )}

          <Section title="Raw JSON">
            <pre className="raw-json">{JSON.stringify(log, null, 2)}</pre>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="detail-section">
      <div className="section-title">{title}</div>
      {children}
    </div>
  );
}

function Field({ label, value, mono }) {
  if (!value) return null;
  return (
    <div className="detail-field">
      <span className="field-label">{label}</span>
      <span className={`field-value ${mono ? 'mono' : ''}`}>{value}</span>
    </div>
  );
}
