import { createClient } from '@supabase/supabase-js';
import { hashPassword, generateTemporaryPassword } from '../../api-lib/auth/password-utils.js';

const REQUIRED_ENV_VARS = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'RESEND_API_KEY'];

for (const name of REQUIRED_ENV_VARS) {
  if (!process.env[name]) {
    throw new Error(`Missing environment variable ${name} for reset handler`);
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const RESEND_API_KEY = process.env.RESEND_API_KEY!;
const RESET_PASSWORD_LOGIN_URL =
  process.env.RESET_PASSWORD_LOGIN_URL ?? 'https://zelenaliga.cz/aplikace/setonuv-zavod?reset=1';

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

function applyCors(res: any) {
  for (const [key, value] of Object.entries(corsHeaders)) {
    res.setHeader(key, value);
  }
}

async function sendResetEmail(to: string, password: string, displayName?: string): Promise<string> {
  const from = 'Zelená liga <noreply@zelenaliga.cz>';
  const replyTo = 'info@zelenaliga.cz';
  const subject = 'Dočasné heslo do aplikace Zelená liga';
  
  // Build professional HTML using inline styles (email-compatible)
  const preheader = 'V e-mailu najdete dočasné heslo a odkaz na přihlášení';
  
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333;">
  <!-- Preheader (hidden) -->
  <div style="display: none; max-height: 0; overflow: hidden;">
    ${preheader}
  </div>

  <!-- Header gradient -->
  <div style="background: linear-gradient(to right, #0b8e3f, #06642b); padding: 32px 20px; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 24px; font-weight: 600;">Zelená Liga</h1>
    <p style="color: rgba(255,255,255,0.9); margin: 4px 0 0; font-size: 13px;">SPTO Brno</p>
  </div>

  <!-- Main content -->
  <div style="max-width: 600px; margin: 0 auto; background: white; padding: 32px 24px;">
    <p style="margin: 0 0 20px; font-size: 16px; color: #333; line-height: 1.5;">
      Dobrý den ${displayName ? displayName : 'rozhodčí'},
    </p>

    <p style="margin: 0 0 20px; font-size: 16px; color: #333; line-height: 1.5;">
      Obdrželi jste tento e-mail, protože jste požádali o resetování hesla do aplikace Zelené ligy. Pokud jste to nebyli vy, můžete bezpečně ignorovat tento e-mail.
    </p>

    <!-- Security info card -->
    <div style="background: #eef9f0; border: 1px solid #cfe8d8; border-radius: 6px; padding: 16px; margin: 20px 0;">
      <h3 style="color: #06642b; margin: 0 0 12px; font-size: 14px; font-weight: 600; text-transform: uppercase;">Dočasné přihlašovací údaje</h3>
      <p style="margin: 0;">
        <strong>Dočasné heslo:</strong>
      </p>
      <p style="margin: 8px 0 0; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; font-size: 18px; letter-spacing: 0.06em; color: #04372c;">
        ${password}
      </p>
    </div>

    <p style="margin: 20px 0; font-size: 14px; color: #666; line-height: 1.5; text-align: center;">
      Klikněte na tlačítko níže, přihlaste se tímto dočasným heslem a aplikace vás vyzve k nastavení nového hesla:
    </p>

    <!-- CTA Button -->
    <div style="text-align: center; margin: 20px 0;">
      <a href="${RESET_PASSWORD_LOGIN_URL}" style="display: inline-block; background: #ffd700; color: black; padding: 14px 28px; border-radius: 4px; text-decoration: none; font-weight: 600; font-size: 14px;">
        Otevřít přihlášení
      </a>
    </div>

    <!-- Fallback link -->
    <p style="margin: 0; font-size: 12px; color: #0b8e3f; text-align: center;">
      Pokud se vám tlačítko nezobrazilo,
      <a href="${RESET_PASSWORD_LOGIN_URL}" style="color: #0b8e3f; text-decoration: underline;">
        klikněte sem
      </a>
    </p>

    <!-- Security notice -->
    <div style="margin: 20px 0 0; padding: 12px; background: #eef9f0; border: 1px solid #cfe8d8; border-radius: 4px; font-size: 12px; color: #555; line-height: 1.4;">
      <strong style="color: #06642b;">⚠️ Bezpečnostní tip:</strong> Pokud jste tento e-mail neodeslali, zkontrolujte si bezpečnost svého účtu. Nevěřte nikomu, kdo vám posílá odkazy na přihlášení e-mailem.
    </div>

    <hr style="margin: 20px 0; border: none; border-top: 1px solid #e8e8e8;">

    <p style="margin: 20px 0 0; font-size: 12px; color: #999; line-height: 1.5;">
      Máte-li problémy s přihlášením, kontaktujte prosím info@zelenaliga.cz.
    </p>
  </div>

  <!-- Footer -->
  <div style="background: #f9f9f9; padding: 20px; text-align: center; font-size: 12px; color: #999;">
    <p style="margin: 0;">Zelená liga SPTO • Brno</p>
    <p style="margin: 8px 0 0;">
      <a href="mailto:info@zelenaliga.cz" style="color: #0b8e3f; text-decoration: none;">info@zelenaliga.cz</a>
    </p>
  </div>
</body>
</html>
  `;

  const text = [
    'Dobrý den,',
    'zasíláme vám nové dočasné heslo k účtu rozhodčího.',
    `Dočasné heslo: ${password}`,
    `Přihlášení: ${RESET_PASSWORD_LOGIN_URL}`,
    'Po přihlášení budete vyzváni ke změně hesla.',
    'Pokud jste obnovu nevyžádali, kontaktujte prosím organizátory.',
    'Děkujeme.',
  ].join('\n');

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html,
      text,
      reply_to: replyTo,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Failed to send email (${response.status}): ${body || '<no body>'}`);
  }

  const body = await response.json().catch(() => ({} as Record<string, unknown>));
  const messageId = typeof body?.id === 'string' ? body.id : '';
  return messageId;
}

export default async function handler(req: any, res: any) {
  applyCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { email } = req.body ?? {};
  if (typeof email !== 'string' || !email.trim()) {
    return res.status(400).json({ error: 'Missing email' });
  }

  const normalizedEmail = email.trim();
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: judge, error: judgeError } = await supabase
    .from('judges')
    .select('id, email, display_name, password_hash, must_change_password, password_rotated_at')
    .ilike('email', normalizedEmail)
    .limit(1)
    .maybeSingle();

  if (judgeError) {
    console.error('Failed to load judge for reset', judgeError);
    return res.status(500).json({ error: 'DB error' });
  }

  if (!judge) {
    // Avoid leaking whether the email exists.
    return res.status(200).json({ success: true });
  }

  const temporaryPassword = generateTemporaryPassword(12);
  const newHash = await hashPassword(temporaryPassword);
  const nowIso = new Date().toISOString();

  const { error: updateError } = await supabase
    .from('judges')
    .update({
      password_hash: newHash,
      must_change_password: true,
      password_rotated_at: nowIso,
      updated_at: nowIso,
    })
    .eq('id', judge.id);

  if (updateError) {
    console.error('Failed to rotate password', updateError);
    return res.status(500).json({ error: 'Failed to reset password' });
  }

  try {
    const targetEmail = judge.email && typeof judge.email === 'string' ? judge.email : normalizedEmail;
    const displayName = judge.display_name && typeof judge.display_name === 'string' ? judge.display_name : undefined;
    const messageId = await sendResetEmail(targetEmail, temporaryPassword, displayName);

    const { data: assignment } = await supabase
      .from('judge_assignments')
      .select('event_id, station_id')
      .eq('judge_id', judge.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const metadata = {
      type: 'password-reset-issued',
      email: targetEmail,
      sent: true,
      sent_at: nowIso,
      provider: 'resend',
      message_id: messageId,
      source: 'self-service',
    } as Record<string, unknown>;

    const { error: eventError } = await supabase.from('judge_onboarding_events').insert({
      judge_id: judge.id,
      event_id: assignment?.event_id ?? null,
      station_id: assignment?.station_id ?? null,
      delivery_channel: 'email',
      metadata,
    });

    if (eventError) {
      console.error('Failed to record onboarding event', eventError);
    }
  } catch (error) {
    console.error('Failed to send reset email', error);
    await supabase
      .from('judges')
      .update({
        password_hash: judge.password_hash,
        must_change_password: judge.must_change_password,
        password_rotated_at: judge.password_rotated_at ?? null,
      })
      .eq('id', judge.id);
    return res.status(500).json({ error: 'Failed to send reset email' });
  }

  return res.status(200).json({ success: true });
}
