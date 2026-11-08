import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Send, ShieldCheck } from 'lucide-react';

const examples = [
  'Where is order ord_sarah_101?',
  'My headphones are not connecting. I want a refund.',
  'The headphones are defective and not charging. I want to return them.',
  'My device battery is swollen and heating up.'
];

async function readApiResponse(response, fallback) {
  const contentType = response.headers.get('content-type') || '';
  const body = await response.text();
  let data;
  try { data = JSON.parse(body); }
  catch {
    if (contentType.includes('text/html') || body.trimStart().startsWith('<')) {
      throw new Error(`The support API returned a webpage (HTTP ${response.status}). The backend may be stale or /api may not be proxied to it. Restart or redeploy the latest backend, then try again.`);
    }
    throw new Error(`The support API returned an unreadable response (HTTP ${response.status}). Restart the backend and try again.`);
  }
  if (!response.ok) throw new Error(data.error || fallback);
  return data;
}

export default function SupportConversation({ currentUser, onSecurityEvent }) {
  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [approvals, setApprovals] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setConversationId(null); setMessages([]); setError('');
    const key = `agentshield-support-conversation:${currentUser.id}`;
    const savedId = window.sessionStorage.getItem(key);
    if (savedId) {
      fetch(`/api/support/conversations/${encodeURIComponent(savedId)}`, { headers: { 'X-User-Id': currentUser.id } })
        .then(async response => {
          const data = await readApiResponse(response, 'Could not restore the conversation.');
          if (!cancelled) {
            setConversationId(savedId);
            setMessages((data.messages || []).map(item => ({ role: item.role, content: item.content, classification: item.metadata?.classification, eligibility: item.metadata?.eligibility })));
          }
        }).catch(err => { if (!cancelled) setError(err.message); });
    }
    return () => { cancelled = true; };
  }, [currentUser.id]);
  useEffect(() => { if (currentUser.role === 'admin') loadAdminData(); }, [currentUser.id, currentUser.role]);

  async function loadAdminData() {
    try {
      const headers = { 'X-User-Id': currentUser.id };
      const responses = await Promise.all([
        fetch('/api/support/refund-approvals', { headers }), fetch('/api/support/tickets', { headers }), fetch('/api/support/admin/summary', { headers })
      ]);
      const data = await Promise.all(responses.map(response => readApiResponse(response, 'Could not load the support admin queue.')));
      setApprovals(data[0].requests || []); setTickets(data[1].tickets || []); setSummary(data[2].summary || null);
    } catch (err) { setError(err.message); }
  }

  async function send(value = draft) {
    const message = value.trim();
    if (!message || busy) return;
    setMessages(prev => [...prev, { role: 'user', content: message }]);
    setDraft(''); setBusy(true); setError('');
    try {
      const response = await fetch('/api/support/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User-Id': currentUser.id },
        body: JSON.stringify({ conversationId, message })
      });
      const data = await readApiResponse(response, 'Support request failed.');
      setConversationId(data.conversationId);
      window.sessionStorage.setItem(`agentshield-support-conversation:${currentUser.id}`, data.conversationId);
      setMessages(prev => [...prev, { role: 'assistant', content: data.message, classification: data.classification, metadata: data.metadata, order: data.order, eligibility: data.eligibility }]);
      onSecurityEvent?.();
      if (currentUser.role === 'admin') loadAdminData();
    } catch (err) { setMessages(prev => prev.slice(0, -1)); setDraft(message); setError(err.message); }
    finally { setBusy(false); }
  }

  async function review(id, decision) {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/support/refund-approvals/${id}/review`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User-Id': currentUser.id },
        body: JSON.stringify({ decision, note: decision === 'APPROVE' ? 'Approved in demo review queue.' : 'Rejected in demo review queue.' })
      });
      const data = await readApiResponse(response, 'Review failed.');
      await loadAdminData(); onSecurityEvent?.();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function updateTicket(ticketId, status) {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/support/tickets/${ticketId}/status`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User-Id': currentUser.id },
        body: JSON.stringify({ status })
      });
      const data = await readApiResponse(response, 'Ticket update failed.');
      await loadAdminData(); onSecurityEvent?.();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return <section className="card" style={{ marginBottom: 20 }}>
    <div className="card-title"><span>Customer conversation</span><span className="badge badge-subtle">Persistent · verified demo data</span></div>
    <p style={{ color: 'var(--text-muted)', marginTop: 0 }}>Ask about an order or describe a product problem. Refunds are checked against order records and policy; eligible requests wait for a human reviewer.</p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
      {examples.map(item => <button key={item} className="btn btn-secondary btn-sm" disabled={busy} onClick={() => send(item)}>{item}</button>)}
    </div>
    <div aria-live="polite" style={{ minHeight: 180, maxHeight: 360, overflowY: 'auto', padding: 12, background: 'var(--bg-input)', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {!messages.length && <p style={{ color: 'var(--text-muted)' }}>Start with an order status question or report a product issue.</p>}
      {messages.map((item, i) => <div key={i} style={{ alignSelf: item.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '88%', padding: '10px 12px', borderRadius: 8, background: item.role === 'user' ? 'var(--bg-elevated)' : 'var(--bg-allow)', border: '1px solid var(--border-subtle)' }}>
        <div style={{ fontSize: 11, opacity: .7, marginBottom: 4 }}>{item.role === 'user' ? 'YOU' : `AGENTSHIELD SUPPORT${item.classification ? ` · ${item.classification}` : ''}`}</div>
        <div>{item.content}</div>
        {item.eligibility && <div style={{ marginTop: 6, fontSize: 12 }}>Refund check: {item.eligibility.decision} · {item.eligibility.reasons?.join(' ')}</div>}
      </div>)}
      {busy && <div style={{ color: 'var(--text-muted)' }}>Checking verified support records…</div>}
    </div>
    <form onSubmit={e => { e.preventDefault(); send(); }} style={{ display: 'flex', gap: 8, marginTop: 10 }}>
      <input className="input" value={draft} onChange={e => setDraft(e.target.value)} maxLength={2000} placeholder="Describe what you need help with…" aria-label="Support message" />
      <button className="btn btn-primary" disabled={busy || !draft.trim()}><Send size={16} /> Send</button>
    </form>
    {error && <div role="alert" style={{ color: 'var(--color-deny)', marginTop: 8 }}>{error}</div>}
    {currentUser.role === 'admin' && <div style={{ marginTop: 24 }}>
      {summary && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(145px,1fr))', gap: 8, marginBottom: 18 }}>
        {Object.entries({ 'Open tickets': summary.openTickets, 'Open issues': summary.openIssues, 'Refund approvals': summary.pendingRefundApprovals, 'Safety escalations': summary.safetyEscalations }).map(([label, count]) => <div key={label} style={{ padding: 10, border: '1px solid var(--border-subtle)', borderRadius: 8, background: 'var(--bg-input)' }}><small style={{ color: 'var(--text-muted)' }}>{label}</small><div style={{ fontSize: 20, fontWeight: 700 }}>{count}</div></div>)}
      </div>}
      <div className="card-title"><span><ShieldCheck size={17} /> Human refund review</span><span className="badge badge-subtle">{approvals.filter(x => x.status === 'PENDING').length} pending</span></div>
      {!approvals.length && <p style={{ color: 'var(--text-muted)' }}>No refund requests yet. Customer requests appear here after verification.</p>}
      {approvals.map(row => <div key={row.id} style={{ borderTop: '1px solid var(--border-subtle)', padding: '12px 0', display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div><strong>{row.status}</strong> · {row.order_id} · ${Number(row.amount).toFixed(2)} · {row.customer_name}<div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{row.reason}</div></div>
        {row.status === 'PENDING' && <div style={{ display: 'flex', gap: 8 }}><button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => review(row.id, 'REJECT')}><AlertTriangle size={14} /> Reject</button><button className="btn btn-primary btn-sm" disabled={busy} onClick={() => review(row.id, 'APPROVE')}><CheckCircle2 size={14} /> Approve sandbox refund</button></div>}
      </div>)}
      <small style={{ color: 'var(--text-muted)' }}>Approval changes only the local sandbox ledger; no payment provider is connected.</small>
      <div className="card-title" style={{ marginTop: 22 }}><span>Support tickets and escalations</span></div>
      {!tickets.length && <p style={{ color: 'var(--text-muted)' }}>No tickets have been created.</p>}
      {tickets.map(ticket => <div key={ticket.id} style={{ borderTop: '1px solid var(--border-subtle)', padding: '10px 0', display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div><strong>{ticket.category}</strong> · {ticket.status} · {ticket.customer_name}{ticket.order_id ? ` · ${ticket.order_id}` : ''}<div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{ticket.summary}</div></div>
        {['OPEN', 'IN_PROGRESS'].includes(ticket.status) && <div style={{ display: 'flex', gap: 8 }}><button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => updateTicket(ticket.id, 'IN_PROGRESS')}>In progress</button><button className="btn btn-primary btn-sm" disabled={busy} onClick={() => updateTicket(ticket.id, 'RESOLVED')}>Resolve</button></div>}
      </div>)}
    </div>}
  </section>;
}
