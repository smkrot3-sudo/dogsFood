// The in-app assistant ("✨ העוזר"). The Gemini key lives only here (secret GEMINI_API_KEY), never in the page.
// The page sends the user's own data as text; nothing the user asks or gets back is stored. Only a per-day count
// per tool is kept (ai_usage) for the daily limit and the owner's admin panel.
import { createClient } from "npm:@supabase/supabase-js@2";

const OWNER = "75753136-73de-4975-bc7a-5897db6ae434";
const DAILY_LIMIT = 20;
const MODELS = (Deno.env.get("GEMINI_MODEL") || "gemini-flash-latest,gemini-2.5-flash,gemini-flash-lite-latest,gemini-2.5-flash-lite").split(",").map((s) => s.trim()).filter(Boolean);
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const TONE: Record<string, string> = {
  tough: "דבר ישיר וקשוח, בלי ליפות ובלי הנחות, אבל בלי להעליב.",
  mid: "דבר ישיר אבל מאוזן: אומר את האמת בעדינות.",
  soft: "דבר רך ומעודד, בלי להאשים.",
};
const BASE = (tone: string, today: string) => `אתה "העוזר" בתוך אפליקציית התקציב "התקציב שלי", שנועדה לעזור לאנשים שהכסף נגמר להם לפני סוף החודש.
היום ${today} (שעון ישראל).
כללים:
- כתוב רק בעברית, בשפה פשוטה, קצר ולעניין. בלי מונחים פיננסיים מסובכים.
- ${TONE[tone] || TONE.tough}
- כל המספרים בשקלים (₪). אל תמציא נתונים: אם אין בנתונים תשובה, אמור את זה.
- אתה לא משנה שום דבר באפליקציה ולא מתחייב שעשית משהו. אתה רק מסביר, עונה ומציע.
- הכנסה מהמשמרות היא ברוטו לפי שעות ושכר לשעה, כולל תוספות חוק (שעות נוספות, לילה, שבת וחג).
- אל תשתמש בטבלאות Markdown. מותר להשתמש ברשימות קצרות ובהדגשה **כך**.`;

const PROMPTS: Record<string, string> = {
  chat: `ענה על שאלת המשתמש לפי הנתונים שלו שמופיעים למטה ולפי מדריך האפליקציה.
- שאלה על הכסף שלו: חשב מתוך הנתונים ותן מספר ברור ומשפט אחד של הסבר.
- שאלה איך עושים משהו באפליקציה: הסבר בצעדים קצרים לפי המדריך. אם יש מקום מתאים ברשימת היעדים, הוסף בסוף שורה בפורמט [[go:מפתח]] (מפתח אחד מהרשימה בלבד), והאפליקציה תציג כפתור שלוקח לשם.
- תכנון משמרות ליעד הכנסה: השתמש ביעד, בשכר לשעה ובמה שכבר הרוויח החודש. הזכר ששבת וחג משתלמים יותר (150%).
- שאלות על זכויות עובדים בישראל: תשובה כללית ותמציתית לפי החוק, הפניה ל"כל זכות" (https://www.kolzchut.org.il), ומשפט שזה לא ייעוץ משפטי.
- שאלה שלא קשורה לכסף, לעבודה או לאפליקציה: ענה בקצרה שאתה עוזר רק בנושאים האלה.
התשובה עד 120 מילים, אלא אם ביקשו פירוט.`,
  expenses: `המשתמש כתב או אמר כמה הוצאות במשפט אחד. פרק אותן לרשימה.
החזר JSON בלבד בצורה: {"items":[{"amount":number,"note":"string","cat":"מזהה קטגוריה או ריק","date":"YYYY-MM-DD"}]}
- amount: הסכום בשקלים (מספרים במילים כמו "שתים עשרה" הופכים ל־12).
- note: תיאור קצר של ההוצאה כמו שהמשתמש אמר (למשל "קפה", "פיצה עם חברים").
- cat: המזהה (id) של הקטגוריה הכי מתאימה מתוך רשימת הקטגוריות. אם אף אחת לא מתאימה, מחרוזת ריקה.
- date: היום, אלא אם נאמר אחרת ("אתמול", "ביום ראשון"). לא תאריך עתידי.
- אם אין סכום להוצאה, אל תכלול אותה.`,
  shiftsheet: `בתמונה דוח נוכחות (שעון נוכחות) של עובד. חלץ ממנו את כל ימי העבודה.
החזר JSON בלבד בצורה: {"rows":[{"date":"YYYY-MM-DD","in":"HH:MM","out":"HH:MM","hours":"H:MM","note":"string"}],"total":"HHH:MM או ריק","month":"YYYY-MM"}
- in/out: שעת כניסה ויציאה בפורמט 24 שעות.
- hours: סה"כ השעות לתשלום שכתוב בדוח לאותו יום, אם יש עמודה כזו. אחרת ריק.
- note: "חופשה", "מחלה" או "חג" אם כתוב, אחרת ריק. ימי חופשה או מחלה בלי שעות כניסה ויציאה: כלול עם in ו־out ריקים ו־hours לפי הדוח.
- total: סה"כ השעות של החודש כפי שכתוב בדוח, אם יש.
- השנה: אם לא כתובה, השתמש בחודש הייחוס שניתן. אל תמציא שורות שלא קיימות.`,
  letter: `כתוב "מכתב סוף חודש" אישי למשתמש על החודש שמצוין, לפי הנתונים שלו.
מבנה: פתיחה של משפט אחד עם השורה התחתונה (כמה נכנס, כמה יצא, איך נגמר החודש) ⬅ 2-3 נקודות על מה הלך טוב ⬅ 2-3 נקודות על איפה הכסף דלף (קטגוריות, ״רוצה״, חרטות, מצב רוח אם יש) ⬅ משימה אחת ברורה לחודש הבא.
עד 170 מילים. השתמש באימוג׳י אחד או שניים לכל היותר.`,
  patterns: `חפש בנתונים של המשתמש הרגלים נסתרים שקשורים לבזבוז: ימים בשבוע, שעות או ימים אחרי משמרות, תאריכים בחודש (למשל אחרי המשכורת), קטגוריות שגדלות, ״רוצה״ מול ״צריך״, מצבי רוח, חרטות, הוצאות קטנות שמצטברות.
החזר 3 עד 5 תובנות, כל אחת שורה שמתחילה ב־"• ", עם מספר אמיתי מהנתונים, ובסוף שורה אחת "💡 " עם הצעה מעשית אחת.
אל תמציא דפוס שאין לו תמיכה בנתונים. אם יש מעט מדי נתונים, אמור כמה עוד צריך לרשום.`,
  admin_fb: `לפניך משובים שמשתמשי האפליקציה שלחו לבעל האפליקציה. קבץ אותם לנושאים.
לכל נושא: שורה שמתחילה ב־"• " עם שם הנושא, כמה משובים, ומה בדיוק מבקשים או מה מפריע. בסוף שורה "⭐ הכי דחוף:" עם הנושא שכדאי לטפל בו קודם ולמה.
עד 200 מילים.`,
};

async function gemini(key: string, system: string, contents: unknown[], wantJson: boolean) {
  let last = "";
  for (const model of MODELS) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        generationConfig: { temperature: wantJson ? 0.1 : 0.6, maxOutputTokens: 4096, ...(wantJson ? { responseMimeType: "application/json" } : {}) },
      }),
    });
    if (res.ok) {
      const j = await res.json();
      const text = (j.candidates?.[0]?.content?.parts || []).filter((p: { thought?: boolean }) => !p.thought).map((p: { text?: string }) => p.text || "").join("").trim();
      if (text) return { text, model };
      last = "empty";
      continue;
    }
    last = res.status + " " + (await res.text()).slice(0, 300);
    // try the next model on "no such model", quota and overload; a bad key won't get better
    if (![404, 429, 500, 503].includes(res.status)) break;
  }
  throw new Error(last);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const key = Deno.env.get("GEMINI_API_KEY");
    if (!key) return json({ error: "nokey" }, 503);
    const url = Deno.env.get("SUPABASE_URL")!;
    if (new URL(req.url).searchParams.get("ping") === "1") {
      // health check without user data: is the key valid and which models does it see
      const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": key } });
      const j = r.ok ? await r.json() : null;
      return json({ ok: r.ok, status: r.status, models: (j?.models || []).map((m: { name: string }) => m.name.replace("models/", "")).filter((n: string) => /flash/.test(n)) });
    }
    const auth = req.headers.get("Authorization") || "";
    const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: u } = await asUser.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
    if (!u?.user) return json({ error: "auth" }, 401);
    const uid = u.user.id, isOwner = uid === OWNER;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const body = await req.json();
    const tool = String(body.tool || "");
    if (tool === "status") return json({ ok: true });
    if (tool === "admin_usage") {
      if (!isOwner) return json({ error: "forbidden" }, 403);
      const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
      const { data } = await admin.from("ai_usage").select("user_id, day, tool, n").gte("day", since);
      return json({ rows: data || [] });
    }
    if (!PROMPTS[tool]) return json({ error: "tool" }, 400);
    if (tool.startsWith("admin") && !isOwner) return json({ error: "forbidden" }, 403);

    const used = await admin.rpc("ai_bump", { p_user: uid, p_tool: tool, p_limit: isOwner || tool.startsWith("admin") ? 0 : DAILY_LIMIT });
    if (used.error) throw new Error(used.error.message);
    if (used.data === -1) return json({ error: "limit", limit: DAILY_LIMIT }, 429);

    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
    let system = BASE(String(body.tone || "tough"), today) + "\n\n" + PROMPTS[tool];
    const ctx = String(body.context || "").slice(0, 120000);
    if (tool === "admin_fb") {
      const { data } = await admin.from("feedback").select("kind, body, page, created_at").order("created_at", { ascending: false }).limit(200);
      system += "\n\nהמשובים:\n" + (data || []).map((f) => `- [${f.created_at.slice(0, 10)}] ${f.kind || ""}: ${(f.body || "").replace(/\s+/g, " ").slice(0, 400)}`).join("\n");
    } else if (ctx) {
      system += "\n\n=== הנתונים של המשתמש ===\n" + ctx;
    }

    const contents: unknown[] = [];
    if (tool === "chat") {
      const hist = Array.isArray(body.history) ? body.history.slice(-10) : [];
      hist.forEach((m: { role: string; text: string }) => contents.push({ role: m.role === "ai" ? "model" : "user", parts: [{ text: String(m.text || "").slice(0, 2000) }] }));
    }
    const parts: unknown[] = [{ text: String(body.input || (tool === "letter" ? "כתוב את המכתב." : tool === "patterns" ? "מה ההרגלים הנסתרים שלי?" : tool === "admin_fb" ? "סכם את המשובים." : "")).slice(0, 4000) }];
    if (tool === "shiftsheet" && body.image && body.mime) parts.push({ inlineData: { mimeType: String(body.mime), data: String(body.image) } });
    contents.push({ role: "user", parts });

    const wantJson = tool === "expenses" || tool === "shiftsheet";
    const out = await gemini(key, system, contents, wantJson);
    if (wantJson) {
      let parsed: unknown = null;
      try { parsed = JSON.parse(out.text.replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch (_) { /* fall through */ }
      if (!parsed) return json({ error: "parse" }, 502);
      return json({ data: parsed, left: isOwner ? null : DAILY_LIMIT - used.data });
    }
    return json({ text: out.text, left: isOwner ? null : DAILY_LIMIT - used.data });
  } catch (e) {
    const msg = String((e as Error).message || e);
    console.error("ai error", msg);
    return json({ error: /^429/.test(msg) ? "busy" : "fail" }, 502);
  }
});
