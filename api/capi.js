import crypto from "node:crypto";

const FB_API_VERSION = "v19.0";
const ALLOWED_EVENTS = new Set(["ViewContent", "Lead"]);

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(String(value).trim().toLowerCase())
    .digest("hex");
}

function hashPhone(phone) {
  const digits = String(phone).replace(/\D/g, "");
  return crypto.createHash("sha256").update(digits).digest("hex");
}

function getClientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (xff) {
    return String(xff).split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const PIXEL_ID = process.env.FB_PIXEL_ID;
  const TOKEN = process.env.FB_CAPI_TOKEN;

  if (!PIXEL_ID || !TOKEN) {
    return res.status(500).json({
      error: "CAPI not configured. Set FB_PIXEL_ID and FB_CAPI_TOKEN env vars in Vercel.",
    });
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: "Invalid JSON body" });
    }
  }

  const eventName = body?.event_name;
  if (!ALLOWED_EVENTS.has(eventName)) {
    return res.status(400).json({ error: `Unsupported event_name: ${eventName}` });
  }

  const eventTime = Number.isFinite(body.event_time)
    ? Math.floor(body.event_time)
    : Math.floor(Date.now() / 1000);

  const eventSourceUrl = String(body.event_source_url || "").slice(0, 2048);
  const eventId = body.event_id ? String(body.event_id).slice(0, 200) : undefined;

  const userData = {
    client_user_agent: req.headers["user-agent"] || "",
  };
  const ip = getClientIp(req);
  if (ip) userData.client_ip_address = ip;

  if (eventName === "Lead") {
    if (body.email) userData.em = [sha256(body.email)];
    if (body.phone) userData.ph = [hashPhone(body.phone)];
  }

  const payload = {
    data: [
      {
        event_name: eventName,
        event_time: eventTime,
        action_source: "website",
        event_source_url: eventSourceUrl,
        ...(eventId && { event_id: eventId }),
        user_data: userData,
        ...(body.custom_data && { custom_data: body.custom_data }),
      },
    ],
  };

  if (body.test_event_code) {
    payload.test_event_code = String(body.test_event_code);
  }

  const fbUrl = `https://graph.facebook.com/${FB_API_VERSION}/${PIXEL_ID}/events?access_token=${encodeURIComponent(TOKEN)}`;

  try {
    const fbResp = await fetch(fbUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const fbData = await fbResp.json().catch(() => ({}));

    if (!fbResp.ok) {
      return res.status(502).json({ error: "Facebook API error", detail: fbData });
    }

    return res.status(200).json({ ok: true, fb: fbData, event_id: eventId });
  } catch (err) {
    return res.status(500).json({ error: "Upstream fetch failed", detail: String(err) });
  }
}
