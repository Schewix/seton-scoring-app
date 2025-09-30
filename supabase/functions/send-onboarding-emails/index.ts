/// <reference path="../types.d.ts" />

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const EVENT_ID = Deno.env.get("SYNC_EVENT_ID") ?? Deno.env.get("EVENT_ID");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SYNC_SECRET = Deno.env.get("SYNC_SECRET"); // volitelné – stejné jako u sync-judges

if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
if (!SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
if (!EVENT_ID) throw new Error("Missing SYNC_EVENT_ID (or EVENT_ID)");
if (!RESEND_API_KEY) throw new Error("Missing RESEND_API_KEY");

type OnboardingEvent = {
  id: string;
  judge_id: string | null;
  metadata: Record<string, unknown> | null;
};

function generatePassword(length = 10): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"; // bez podobných znaků
  let out = "";
  const rnd = crypto.getRandomValues(new Uint32Array(length));
  for (let i = 0; i < length; i++) {
    out += alphabet[rnd[i] % alphabet.length];
  }
  return out;
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = 210_000;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), { name: "PBKDF2" }, false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256 // 32 B
  );
  const encoded = `pbkdf2$sha256$${iterations}$${toBase64(salt.buffer)}$${toBase64(derived)}`;
  return encoded;
}

async function sendEmail(to: string, password: string): Promise<string> {
  const from = "Zelená liga <noreply@zelenaliga.cz>";
  const replyTo = "info@zelenaliga.cz"; // kam půjdou případné odpovědi (můžeš změnit nebo smazat)
  const subject = "Zelená liga — váš účet rozhodčího";

  const text = [
    "Dobrý den,",
    "byl vám vytvořen účet rozhodčího v systému Zelená liga.",
    `Dočasné heslo: ${password}`,
    "Po přihlášení budete vyzváni ke změně hesla.",
    "Děkujeme.",
  ].join("\n");

  const html = `
    <p>Dobrý den,</p>
    <p>byl vám vytvořen účet rozhodčího. Přihlaste se prosím tímto dočasným heslem:</p>
    <p style="font-size:18px"><b>${password}</b></p>
    <p>Po přihlášení budete vyzváni ke změně hesla.</p>
    <p>Děkujeme.</p>
  `;

  const ac = new AbortController();
  const FETCH_TIMEOUT_MS = 1500; // keep requests snappy in cron
  const fetchTimer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html,
      text,
      reply_to: replyTo,
    }),
    signal: ac.signal,
  });

  clearTimeout(fetchTimer);

  if (!resp.ok) {
    const bodyTxt = await resp.text().catch(() => "");
    throw new Error(`Resend error status=${resp.status} body=${bodyTxt || "<no body>"} aborted=${ac.signal.aborted}`);
  }

  const body = await resp.json().catch(() => ({} as Record<string, unknown>));
  const messageId = typeof body?.id === "string" ? body.id : "";
  return messageId;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  if (SYNC_SECRET) {
    const header = req.headers.get("authorization");
    if (!header || header !== `Bearer ${SYNC_SECRET}`) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry_run") === "true";
  const debug = url.searchParams.get("debug") === "1";
  const mode = url.searchParams.get("mode") || "";
  const forceReset = mode === "force-reset";

  const supabase = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);

  // ---- 5s cron guardrails ----
  const STARTED = Date.now();
  const CRON_BUDGET_MS = 4000;   // keep well under the 5s scheduler limit
  const MAX_PER_RUN = 5;         // process at most 5 emails per run
  let processed = 0;

  // Vytáhneme události, které:
  // - patří do daného eventu,
  // - jsou pro email (delivery_channel='email' nebo delivery_channel IS NULL),
  // - mají typ 'initial-password-issued',
  // - ještě nebyly odeslané (metadata.sent !== true)
  const { data, error } = await supabase
    .from("judge_onboarding_events")
    .select("id, judge_id, metadata")
    .eq("event_id", EVENT_ID)
    .or("delivery_channel.eq.email,delivery_channel.is.null");

  if (error) {
    console.error("Failed to load onboarding events", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  const skipped = {
    not_initial_type: 0,
    already_sent: 0,
    missing_email: 0,
    missing_password: 0,
    forced_password_resets: 0,
  };

  const candidates: (OnboardingEvent & { resolvedEmail: string; resolvedPassword: string; resolvedType: string })[] = [];
  for (const row of (data as OnboardingEvent[] | null) ?? []) {
    const m = (row.metadata ?? {}) as Record<string, unknown>;
    if (m["type"] !== "initial-password-issued") { skipped.not_initial_type++; continue; }
    if (m["sent"] === true) { skipped.already_sent++; continue; }

    // resolve email (from metadata or judges table)
    let email = typeof m["email"] === "string" ? String(m["email"]) : "";
    if (!email && row.judge_id) {
      const { data: jrow } = await supabase
        .from("judges")
        .select("email")
        .eq("id", row.judge_id)
        .maybeSingle();
      if (jrow?.email && typeof jrow.email === "string") email = jrow.email;
    }
    if (!email) { skipped.missing_email++; continue; }

    // resolve password or force-reset
    let password = typeof m["password"] === "string" ? String(m["password"]) : "";
    let resolvedType = "initial-password-issued";
    if (!password) {
      if (!forceReset || !row.judge_id) { skipped.missing_password++; continue; }
      // create a new temporary password and rotate it on the judge record
      const newPass = generatePassword(12);
      const newHash = await hashPassword(newPass);
      if (!dryRun) {
        const { error: updJudgeErr } = await supabase
          .from("judges")
          .update({
            password_hash: newHash,
            must_change_password: true,
            password_rotated_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.judge_id);
        if (updJudgeErr) {
          // if update fails, skip this event
          skipped.missing_password++; // reuse bucket
          continue;
        }
      }
      password = newPass;
      resolvedType = "password-reset-issued";
      skipped.forced_password_resets++;
    }

    candidates.push({ ...row, resolvedEmail: email, resolvedPassword: password, resolvedType });
  }

  type SendSummary = {
    scanned: number;
    toSend: number;
    sent: number;
    failed: number;
    dryRun: boolean;
    errors: string[];
    skipped?: {
      not_initial_type: number;
      already_sent: number;
      missing_email: number;
      missing_password: number;
      forced_password_resets: number;
    };
  };

  const summary: SendSummary = {
    scanned: data?.length ?? 0,
    toSend: candidates.length,
    sent: 0,
    failed: 0,
    dryRun,
    errors: [],
  };
  if (debug) summary.skipped = skipped;
  if (debug) (summary as any).mode = mode;

  for (const ev of candidates) {
    // stop early if we are close to the scheduler timeout
    if (processed >= MAX_PER_RUN) break;
    if (Date.now() - STARTED > CRON_BUDGET_MS) break;
    processed++;

    const md = (ev.metadata ?? {}) as Record<string, unknown>;
    const email = (ev as any).resolvedEmail as string;
    const password = (ev as any).resolvedPassword as string;

    try {
      if (!dryRun) {
        const messageId = await sendEmail(email, password);

        // označíme jako odeslané (metadata.sent=true, metadata.sent_at=now)
        const { password: _pw, ...restMd } = md as Record<string, unknown>;
        const newMetadata = {
          ...restMd,
          type: (ev as any).resolvedType || restMd["type"],
          email, // persist resolved email for audit
          sent: true,
          sent_at: new Date().toISOString(),
          provider: "resend",
          message_id: messageId,
        };
        const { error: updErr } = await supabase
          .from("judge_onboarding_events")
          .update({ metadata: newMetadata })
          .eq("id", ev.id);

        if (updErr) throw new Error(`Update failed: ${updErr.message}`);

        summary.sent += 1;
        console.log(`Onboarding email sent: ${email} (message_id=${messageId})`);
      } else {
        summary.sent += 1;
      }
    } catch (e) {
      summary.failed += 1;
      summary.errors.push(`id=${ev.id} email=${email}: ${e instanceof Error ? e.message : String(e)}`);
      // Poznámka: necháváme neodeslané pro další pokus v příštím běhu
    }
  }

  return new Response(JSON.stringify(summary), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});