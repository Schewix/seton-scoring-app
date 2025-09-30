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
  metadata: Record<string, unknown> | null;
};

async function sendEmail(to: string, password: string) {
  const from = "Seton <noreply@your-domain.tld>"; // TODO: nastav si vlastní odesílatele/doménu v Resend
  const subject = "Váš účet rozhodčího na Seton";
  const html = `
    <p>Dobrý den,</p>
    <p>byl vám vytvořen účet rozhodčího. Přihlaste se prosím tímto dočasným heslem:</p>
    <p style="font-size:18px"><b>${password}</b></p>
    <p>Po přihlášení budete vyzváni ke změně hesla.</p>
    <p>Děkujeme.</p>
  `;

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
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Resend error ${resp.status}: ${text}`);
  }
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

  const supabase = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);

  // Vytáhneme události, které:
  // - patří do daného eventu,
  // - jsou pro email (delivery_channel='email'),
  // - mají typ 'initial-password-issued',
  // - ještě nebyly odeslané (metadata.sent !== true)
  const { data, error } = await supabase
    .from("judge_onboarding_events")
    .select("id, metadata")
    .eq("event_id", EVENT_ID)
    .eq("delivery_channel", "email");

  if (error) {
    console.error("Failed to load onboarding events", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  const candidates: OnboardingEvent[] =
    (data as OnboardingEvent[] | null)?.filter((row) => {
      const m = (row.metadata ?? {}) as Record<string, unknown>;
      return (
        (m["type"] === "initial-password-issued") &&
        (m["sent"] !== true) &&
        typeof m["email"] === "string" &&
        typeof m["password"] === "string"
      );
    }) ?? [];

  const summary = {
    scanned: data?.length ?? 0,
    toSend: candidates.length,
    sent: 0,
    failed: 0,
    dryRun,
    errors: [] as string[],
  };

  for (const ev of candidates) {
    const md = (ev.metadata ?? {}) as Record<string, unknown>;
    const email = String(md["email"]);
    const password = String(md["password"]);

    try {
      if (!dryRun) {
        await sendEmail(email, password);

        // označíme jako odeslané (metadata.sent=true, metadata.sent_at=now)
        const newMetadata = { ...md, sent: true, sent_at: new Date().toISOString() };
        const { error: updErr } = await supabase
          .from("judge_onboarding_events")
          .update({ metadata: newMetadata })
          .eq("id", ev.id);

        if (updErr) throw new Error(`Update failed: ${updErr.message}`);
      }

      summary.sent += 1;
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