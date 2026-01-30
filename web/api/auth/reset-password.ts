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

async function sendResetEmail(to: string, password: string): Promise<string> {
  const from = 'Zelená liga <noreply@zelenaliga.cz>';
  const replyTo = 'info@zelenaliga.cz';
  const subject = 'Zelená liga — nové dočasné heslo';
  const text = [
    'Dobrý den,',
    'zasíláme vám nové dočasné heslo k účtu rozhodčího.',
    `Dočasné heslo: ${password}`,
    'Po přihlášení budete vyzváni ke změně hesla.',
    'Pokud jste obnovu nevyžádali, kontaktujte prosím organizátory.',
    'Děkujeme.',
  ].join('\n');
  const html = `
    <p>Dobrý den,</p>
    <p>zasíláme vám nové dočasné heslo k účtu rozhodčího:</p>
    <p style="font-size:18px"><b>${password}</b></p>
    <p>Po přihlášení budete vyzváni ke změně hesla.</p>
    <p>Pokud jste obnovu nevyžádali, kontaktujte prosím organizátory.</p>
    <p>Děkujeme.</p>
  `;

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
    .select('id, email, password_hash, must_change_password, password_rotated_at')
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
    const messageId = await sendResetEmail(targetEmail, temporaryPassword);

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
