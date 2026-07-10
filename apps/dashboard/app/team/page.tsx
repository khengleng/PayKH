'use client';

import { useCallback, useEffect, useState } from 'react';
import { Shell } from '@/components/Shell';
import { Button, Card, PageTitle } from '@/components/ui';
import { api } from '@/lib/api';

interface Member { user_id: string; email: string; name: string | null; role: string; joined_at: string }
interface Invite { id: string; email: string; role: string; status: string; expires_at: string }
const ROLES = ['owner', 'developer', 'analyst'];

export default function TeamPage() {
  return <Shell>{({ me }) => <TeamContent orgId={me.organizations[0]?.id} meEmail={me.email} />}</Shell>;
}

function TeamContent({ orgId, meEmail }: { orgId?: string; meEmail: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('developer');
  const [flash, setFlash] = useState('');
  const [inviteToken, setInviteToken] = useState('');

  const load = useCallback(async () => {
    if (!orgId) return;
    const [m, i] = await Promise.all([
      api<Member[]>(`/team/members?org_id=${orgId}`),
      api<Invite[]>(`/team/invitations?org_id=${orgId}`),
    ]);
    setMembers(m); setInvites(i);
  }, [orgId]);
  useEffect(() => { load(); }, [load]);

  const invite = async () => {
    if (!orgId || !email) return;
    const r = await api<{ token: string }>('/team/invitations', { method: 'POST', body: { organizationId: orgId, email, role } });
    setInviteToken(r.token);
    setEmail('');
    await load();
  };
  const changeRole = async (userId: string, newRole: string) => {
    await api(`/team/members/${userId}/role?org_id=${orgId}`, { method: 'POST', body: { role: newRole } });
    await load();
  };
  const remove = async (userId: string) => {
    if (!confirm('Remove this member?')) return;
    await api(`/team/members/${userId}?org_id=${orgId}`, { method: 'DELETE' });
    await load();
  };
  const revoke = async (id: string) => {
    await api(`/team/invitations/${id}/revoke`, { method: 'POST' });
    await load();
  };

  return (
    <>
      <PageTitle title="Team" subtitle="Invite members and manage roles (least privilege)." />

      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex-1 text-sm">
            <div className="mb-1 text-slate-600">Invite by email</div>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@example.com" className="w-full rounded-lg border border-slate-200 px-3 py-2" />
          </label>
          <label className="text-sm">
            <div className="mb-1 text-slate-600">Role</div>
            <select value={role} onChange={(e) => setRole(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2">
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <Button onClick={invite} disabled={!email}>Send invite</Button>
        </div>
        {inviteToken && (
          <div className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm">
            Invitation created. Share this acceptance token with the invitee (email delivery is Phase 4):
            <code className="ml-1 break-all font-mono">{inviteToken}</code>
          </div>
        )}
      </Card>

      <h2 className="mb-2 text-lg font-semibold">Members</h2>
      <Card className="mb-6 overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-100 text-left text-slate-500">
            <tr><th className="px-4 py-3">Email</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Joined</th><th className="px-4 py-3"></th></tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.user_id} className="border-b border-slate-50">
                <td className="px-4 py-3">{m.email}{m.email === meEmail && <span className="ml-1 text-xs text-slate-400">(you)</span>}</td>
                <td className="px-4 py-3">
                  <select value={m.role} onChange={(e) => changeRole(m.user_id, e.target.value)} className="rounded border border-slate-200 px-2 py-1 text-xs">
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </td>
                <td className="px-4 py-3 text-slate-500">{new Date(m.joined_at).toLocaleDateString()}</td>
                <td className="px-4 py-3 text-right">
                  {m.email !== meEmail && <button onClick={() => remove(m.user_id)} className="text-red-600 hover:underline">Remove</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {invites.length > 0 && (
        <>
          <h2 className="mb-2 text-lg font-semibold">Pending invitations</h2>
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <tbody>
                {invites.map((i) => (
                  <tr key={i.id} className="border-b border-slate-50">
                    <td className="px-4 py-3">{i.email}</td>
                    <td className="px-4 py-3 text-slate-500">{i.role}</td>
                    <td className="px-4 py-3 text-slate-400">expires {new Date(i.expires_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3 text-right"><button onClick={() => revoke(i.id)} className="text-red-600 hover:underline">Revoke</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </>
  );
}
