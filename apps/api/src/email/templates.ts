import { EmailMessage } from './email.service';

function layout(title: string, body: string): string {
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;background:#f8fafc;padding:24px">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:28px;border:1px solid #e2e8f0">
    <div style="font-weight:700;font-size:18px;color:#4F46E5;margin-bottom:16px">PayKH</div>
    <h1 style="font-size:18px;margin:0 0 12px">${title}</h1>
    ${body}
    <p style="color:#94a3b8;font-size:12px;margin-top:24px">Bakong KHQR payments · PayKH</p>
  </div></body></html>`;
}

export function inviteEmail(to: string, orgName: string, role: string, acceptUrl: string): EmailMessage {
  return {
    to,
    subject: `You've been invited to ${orgName} on PayKH`,
    html: layout(
      `Join ${orgName}`,
      `<p style="color:#334155">You've been invited to join <b>${orgName}</b> as <b>${role}</b>.</p>
       <p style="margin:20px 0"><a href="${acceptUrl}" style="background:#4F46E5;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Accept invitation</a></p>
       <p style="color:#94a3b8;font-size:12px">If you didn't expect this, you can ignore this email. The invite expires in 7 days.</p>`,
    ),
    text: `You've been invited to join ${orgName} as ${role}. Accept: ${acceptUrl}`,
  };
}

export function quotaWarningEmail(to: string, level: number, used: number, quota: number): EmailMessage {
  const reached = level >= 100;
  return {
    to,
    subject: reached ? 'PayKH quota reached' : `PayKH quota at ${level}%`,
    html: layout(
      reached ? 'Monthly quota reached' : `You've used ${level}% of your quota`,
      `<p style="color:#334155">You've used <b>${used}</b> of <b>${quota}</b> successful payments this month.</p>
       ${reached ? '<p style="color:#dc2626">New payment creation is now blocked (HTTP 402). Upgrade your plan to continue accepting payments.</p>' : ''}
       <p style="margin:20px 0"><a href="https://paykh.cambobia.com/billing" style="background:#4F46E5;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Manage plan</a></p>`,
    ),
    text: `You've used ${used}/${quota} payments this month${reached ? ' — new payments are blocked (402). Upgrade to continue.' : '.'}`,
  };
}

export function verificationEmail(to: string, approved: boolean, reason?: string): EmailMessage {
  return {
    to,
    subject: approved ? 'Your PayKH merchant account is verified' : 'PayKH verification needs attention',
    html: layout(
      approved ? 'You’re verified 🎉' : 'Verification not approved',
      approved
        ? `<p style="color:#334155">Your merchant verification (KYC) was approved. You can now activate <b>live mode</b> and accept real payments.</p>
           <p style="margin:20px 0"><a href="https://paykh.cambobia.com/stores" style="background:#4F46E5;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Go live</a></p>`
        : `<p style="color:#334155">Your verification could not be approved${reason ? `: <b>${reason}</b>` : '.'}</p>
           <p style="color:#334155">Please update your details and resubmit from the dashboard.</p>
           <p style="margin:20px 0"><a href="https://paykh.cambobia.com/settings" style="background:#4F46E5;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Update verification</a></p>`,
    ),
    text: approved
      ? 'Your PayKH merchant verification was approved. You can now activate live mode.'
      : `Your PayKH verification was not approved${reason ? `: ${reason}` : ''}. Please resubmit.`,
  };
}

export function endpointDisabledEmail(to: string, url: string): EmailMessage {
  return {
    to,
    subject: 'PayKH webhook endpoint disabled',
    html: layout(
      'A webhook endpoint was auto-disabled',
      `<p style="color:#334155">Your webhook endpoint <code>${url}</code> was automatically disabled after repeated delivery failures.</p>
       <p style="color:#334155">Fix the endpoint, then re-enable it and resend deliveries from the dashboard.</p>
       <p style="margin:20px 0"><a href="https://paykh.cambobia.com/webhooks" style="background:#4F46E5;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Open webhooks</a></p>`,
    ),
    text: `Webhook endpoint ${url} was auto-disabled after repeated failures. Re-enable it in the dashboard.`,
  };
}
