// The in-app assistant ("✨ העוזר"). The Gemini key lives only here (secret GEMINI_API_KEY), never in the page.
// The page sends the user's own data as text; nothing the user asks or gets back is stored. Only a per-day count
// per tool is kept (ai_usage) for the daily limit and the owner's admin panel.
import { createClient } from "npm:@supabase/supabase-js@2";

const OWNER = "75753136-73de-4975-bc7a-5897db6ae434";
const DAILY_LIMIT = 20;
// VIP users (owner's pick) ask without a daily limit, like the owner
const VIP = ["51ee3304-84e8-4ee2-ac0c-c9ac75ed5b6d"];
// Tried in order; quota, overload, timeout or an unknown model moves on to the next one
const MODELS = (Deno.env.get("GEMINI_MODEL") || "gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-3.8-flash").split(",").map((s) => s.trim()).filter(Boolean);
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
const BASE = (tone: string, today: string, gender = "m") => `אתה "העוזר" בתוך אפליקציית התקציב "התקציב שלי", שנועדה לעזור לאנשים שהכסף נגמר להם לפני סוף החודש.
היום ${today} (שעון ישראל).
כללים:
- כתוב רק בעברית, בשפה פשוטה, קצר ולעניין. בלי מונחים פיננסיים מסובכים.
- ${TONE[tone] || TONE.tough}
- ${gender === "f" ? "המשתמשת היא אישה: פנה אליה תמיד בלשון נקבה (את, יכולה, הוצאת, תחסכי)." : "פנה אל המשתמש בלשון זכר."}
- כל המספרים בשקלים (₪). אל תמציא נתונים: אם אין בנתונים תשובה, אמור את זה.
- מספרים: האפליקציה כבר חישבה סכומים מדויקים (בחלקים ״מספרים מוכנים״ ו״סיכום לפי חודש״). השתמש בהם כמו שהם ואל תחבר שורות בעצמך כשיש שם תשובה.
- אתה לא משנה שום דבר בעצמך ולא כותב שעשית משהו. אתה מסביר, עונה ומציע; כל שינוי המשתמש מאשר בעצמו בכרטיס באפליקציה.
- הכנסה מהמשמרות היא ברוטו לפי שעות ושכר לשעה, כולל תוספות חוק (שעות נוספות, לילה, שבת וחג).
- אל תשתמש בטבלאות Markdown. מותר להשתמש ברשימות קצרות ובהדגשה **כך**.`;

const PROMPTS: Record<string, string> = {
  chat: `ענה על שאלת המשתמש לפי הנתונים שלו שמופיעים למטה ולפי מדריך האפליקציה.
- שאלה על הכסף שלו: קח את המספר מ״מספרים מוכנים״ או מ״סיכום לפי חודש״ ותן מספר ברור ומשפט אחד של הסבר. רק אם אין שם תשובה, חשב מהשורות וכתוב בקצרה שזה חישוב שלך.
- ״החודש״ הוא החודש התקציבי הנוכחי כפי שמופיע ב״מספרים מוכנים״.
- שאלה איך עושים משהו באפליקציה: הסבר בצעדים קצרים לפי המדריך. אם יש מקום מתאים ברשימת היעדים, הוסף בסוף שורה בפורמט [[go:מפתח]] (מפתח אחד מהרשימה בלבד), והאפליקציה תציג כפתור שלוקח לשם.
- תכנון משמרות ליעד הכנסה: השתמש ביעד, בשכר לשעה ובמה שכבר הרוויח החודש. הזכר ששבת וחג משתלמים יותר (150%).
- שאלות על זכויות עובדים בישראל: תשובה כללית ותמציתית לפי החוק, הפניה ל"כל זכות" (https://www.kolzchut.org.il), ומשפט שזה לא ייעוץ משפטי.
- שאלה שלא קשורה לכסף, לעבודה או לאפליקציה: ענה בקצרה שאתה עוזר רק בנושאים האלה.
- בקשה לעשות משהו באפליקציה (לרשום או למחוק הוצאה, להוסיף או להסיר חיוב קבוע/מנוי, לשנות יעד לקטגוריה, לרשום משמרת, לרשום הכנסה חד־פעמית, ״תזכיר לי…״): כתוב משפט אחד קצר מה מוצע, למשל ״הנה, תאשר בכרטיס למטה:״. ובשורה האחרונה בלבד הוסף [[act:JSON]] כשה־JSON הוא {"a":[...]} ובו פעולה אחת או יותר מהסוגים:
  {"t":"exp_add","amount":מספר,"note":"פירוט","cat":"id של קטגוריה","date":"YYYY-MM-DD"}
  {"t":"exp_del","date":"YYYY-MM-DD","amount":מספר,"note":"פירוט"} (הוצאה קיימת מהרשימה)
  {"t":"fixed_add","name":"שם","amount":מספר} (חיוב קבוע או מנוי כל חודש)
  {"t":"fixed_del","name":"שם כמו שמופיע בחיובים הקבועים"}
  {"t":"target","cat":"id של קטגוריה","amount":מספר} (יעד חודשי לקטגוריה; 0 = בלי יעד)
  {"t":"shift_add","date":"YYYY-MM-DD","start":"HH:MM","end":"HH:MM","break":דקות הפסקה}
  {"t":"income_add","date":"YYYY-MM-DD","amount":מספר,"note":"פירוט","kind":"מתנה|החזר מחבר|מכירה|אחר"}
  {"t":"remind","at":"YYYY-MM-DD HH:MM","text":"על מה להזכיר"} (בלי שעה: 10:00)
  תאריכים: היום אלא אם נאמר אחרת (״אתמול״, ״ביום ראשון״). הוצאה, משמרת והכנסה לא בעתיד. אם חסר פרט חיוני (סכום, שעות המשמרת), שאל במקום להציע. אל תכתוב [[act]] כשרק שואלים שאלה.
התשובה עד 120 מילים, אלא אם ביקשו פירוט.`,
  challenge: `הצע למשתמש אתגר אחד לחודש הנוכחי שמתאים להרגלים שלו לפי הנתונים. סוגי אתגרים אפשריים בלבד:
- nospend: מספר ימים בלי אף הוצאה עד סוף החודש (n אחד מ־4, 6, 8, 10, 12; שיהיה אפשרי לפי הימים שנשארו).
- nocat: לא להוציא כלום על קטגוריה אחת עד סוף החודש (cat = id).
- capcat: להוציא על קטגוריה אחת פחות מתקרה (cat = id, amount = תקרה בשקלים, מאתגרת אבל אפשרית).
- nowant: 7 ימים ברצף בלי הוצאה שסומנה ״רוצה״ (רק אם המשתמש מסמן צריך/רוצה).
החזר JSON בלבד: {"k":"nospend|nocat|capcat|nowant","n":מספר או null,"cat":"id או ריק","amount":מספר או null,"why":"משפט אחד קצר למה דווקא האתגר הזה, עם מספר מהנתונים"}`,
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

// Keep "thinking" short so answers come back in seconds
const thinking = (model: string) =>
  /^gemini-2\.5/.test(model) ? { thinkingConfig: { thinkingBudget: 0 } } : /^gemini-3/.test(model) ? { thinkingConfig: { thinkingLevel: "minimal" } } : {};

// One model, one try (plus one more without the thinking setting if this model rejects it)
async function one(key: string, model: string, system: string, contents: unknown[], wantJson: boolean, signal: AbortSignal) {
  for (const think of [true, false]) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        generationConfig: { temperature: wantJson ? 0.1 : 0.6, maxOutputTokens: 4096, ...(think ? thinking(model) : {}), ...(wantJson ? { responseMimeType: "application/json" } : {}) },
      }),
    });
    if (res.ok) {
      const j = await res.json();
      const text = (j.candidates?.[0]?.content?.parts || []).filter((p: { thought?: boolean }) => !p.thought).map((p: { text?: string }) => p.text || "").join("").trim();
      if (text) return { text, model };
      throw new Error("empty " + model);
    }
    const err = res.status + " " + model + " " + (await res.text()).slice(0, 300);
    if (!(res.status === 400 && think && /think/i.test(err))) throw new Error(err);
  }
  throw new Error("unreachable");
}

// The free tier's newest models are often busy or slow, so: start the first model, and if it hasn't answered
// within a few seconds (or failed), start the next one too. The first answer wins; the rest are cancelled.
function race<T>(run: (model: string, ac: AbortController) => Promise<T>, hedgeMs = 6000, models = MODELS): Promise<T> {
  return new Promise((resolve, reject) => {
    let next = 0, running = 0, done = false, last = "";
    let hedge: number | undefined;
    const ctrls: AbortController[] = [];
    const finish = (fn: () => void, keep?: AbortController) => { if (done) return; done = true; clearTimeout(hedge); ctrls.forEach((c) => c !== keep && c.abort()); fn(); };
    const start = () => {
      if (done) return;
      if (next >= models.length) { if (!running) finish(() => reject(new Error(last || "no model"))); return; }
      const model = models[next++];
      running++;
      const ac = new AbortController(); ctrls.push(ac);
      const cap = setTimeout(() => ac.abort(), 30000);
      run(model, ac).then(
        (out) => { clearTimeout(cap); running--; finish(() => resolve(out), ac); },
        (e) => {
          clearTimeout(cap); running--;
          if (done) return;
          last = String((e as Error).message || e).slice(0, 300);
          console.error(last);
          if (/^40[13] |API key not valid/i.test(last)) { finish(() => reject(new Error(last))); return; }
          start();
        },
      );
      clearTimeout(hedge);
      hedge = setTimeout(start, hedgeMs);
    };
    start();
  });
}
const gemini = (key: string, system: string, contents: unknown[], wantJson: boolean, hedgeMs = 6000, models = MODELS) =>
  race((model, ac) => one(key, model, system, contents, wantJson, ac.signal), hedgeMs, models);

// Streaming: the answer goes to the page word by word. A model "wins" when its first words arrive.
async function* sseTexts(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader(), dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      let j; try { j = JSON.parse(line.slice(5)); } catch (_) { continue; }
      const t = (j.candidates?.[0]?.content?.parts || []).filter((p: { thought?: boolean }) => !p.thought).map((p: { text?: string }) => p.text || "").join("");
      if (t) yield t;
    }
  }
}
async function firstWords(key: string, model: string, system: string, contents: unknown[], ac: AbortController) {
  for (const think of [true, false]) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      signal: ac.signal,
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: { temperature: 0.6, maxOutputTokens: 4096, ...(think ? thinking(model) : {}) } }),
    });
    if (res.ok && res.body) {
      const it = sseTexts(res.body);
      const n = await it.next();
      if (n.done) throw new Error("empty " + model);
      return { model, first: n.value as string, it, ac };
    }
    const err = res.status + " " + model + " " + (await res.text()).slice(0, 300);
    if (!(res.status === 400 && think && /think/i.test(err))) throw new Error(err);
  }
  throw new Error("unreachable");
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
      if (new URL(req.url).searchParams.get("gen") === "1") {
        // a tiny generation to check the whole chain end to end (no user data)
        const t0 = Date.now();
        try {
          const pick = new URL(req.url).searchParams.get("m");
          const big = "נתון לדוגמה: הוצאה 18 ₪ על קפה.\n".repeat(Math.min(400, +(new URL(req.url).searchParams.get("pad") || 0)));
          const q = new URL(req.url).searchParams.get("q");
          if (q) {
            // the chat prompt on made-up data, to check how the model answers (and proposes actions)
            const fake = "\n\n=== הנתונים של המשתמש ===\nמזהי קטגוריות לפעולות (id: שם): food: אוכל, car: רכב, fun: בילויים\nחיובים קבועים: דיסני 40\n== הוצאות ==\n2026-10-08 | ה | 18 | אוכל | קפה |";
            const out = await gemini(key, BASE("mid", new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" })) + "\n\n" + PROMPTS.chat + fake, [{ role: "user", parts: [{ text: q.slice(0, 300) }] }], false);
            return json({ ok: true, model: out.model, ms: Date.now() - t0, text: out.text });
          }
          if (new URL(req.url).searchParams.get("stream") === "1") {
            const st = await race((model, ac) => firstWords(key, model, BASE("mid", "היום") + "\n" + big, [{ role: "user", parts: [{ text: "תן 3 טיפים קצרים לחיסכון." }] }], ac));
            const first = Date.now() - t0;
            let text = st.first, chunks = 1;
            for await (const t of st.it) { text += t; chunks++; }
            return json({ ok: true, model: st.model, msFirst: first, ms: Date.now() - t0, chunks, text });
          }
          const out = await gemini(key, BASE("mid", "היום", new URL(req.url).searchParams.get("g") === "f" ? "f" : "m") + "\n" + big, [{ role: "user", parts: [{ text: "כמה הוצאתי על קפה? משפט אחד." }] }], false, 6000, pick ? [pick] : MODELS);
          return json({ ok: true, model: out.model, ms: Date.now() - t0, text: out.text });
        } catch (e) { return json({ ok: false, ms: Date.now() - t0, error: String((e as Error).message).slice(0, 400) }); }
      }
      return json({ ok: r.ok, status: r.status, models: (j?.models || []).map((m: { name: string }) => m.name.replace("models/", "")).filter((n: string) => /flash/.test(n)) });
    }
    const auth = req.headers.get("Authorization") || "";
    const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: u } = await asUser.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
    if (!u?.user) return json({ error: "auth" }, 401);
    const uid = u.user.id, isOwner = uid === OWNER, free = isOwner || VIP.includes(uid);
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

    const used = await admin.rpc("ai_bump", { p_user: uid, p_tool: tool, p_limit: free || tool.startsWith("admin") ? 0 : DAILY_LIMIT });
    if (used.error) throw new Error(used.error.message);
    if (used.data === -1) return json({ error: "limit", limit: DAILY_LIMIT }, 429);

    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
    let system = BASE(String(body.tone || "tough"), today, body.gender === "f" ? "f" : "m") + "\n\n" + PROMPTS[tool];
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
    const parts: unknown[] = [{ text: String(body.input || (tool === "letter" ? "כתוב את המכתב." : tool === "patterns" ? "מה ההרגלים הנסתרים שלי?" : tool === "challenge" ? "איזה אתגר מתאים לי החודש?" : tool === "admin_fb" ? "סכם את המשובים." : "")).slice(0, 4000) }];
    if (tool === "shiftsheet" && body.image && body.mime) parts.push({ inlineData: { mimeType: String(body.mime), data: String(body.image) } });
    contents.push({ role: "user", parts });

    const wantJson = tool === "expenses" || tool === "shiftsheet" || tool === "challenge";
    const left = free ? null : DAILY_LIMIT - used.data;
    // A question that failed doesn't count toward the daily limit, so "try again" is free
    const refund = () => admin.rpc("ai_refund", { p_user: uid, p_tool: tool }).then(() => {}, () => {});
    const t0 = Date.now();
    if (body.stream && !wantJson) {
      let st: Awaited<ReturnType<typeof firstWords>>;
      try { st = await race((model, ac) => firstWords(key, model, system, contents, ac)); }
      catch (e) { await refund(); throw e; }
      const enc = new TextEncoder();
      const stream = new ReadableStream({
        async start(c) {
          const send = (o: unknown) => c.enqueue(enc.encode("data: " + JSON.stringify(o) + "\n\n"));
          const kill = setTimeout(() => st.ac.abort(), 90000);
          try {
            send({ t: st.first });
            for await (const t of st.it) send({ t });
            send({ done: true, left });
            console.log("ai ok stream", tool, st.model, Date.now() - t0, "ms", "context", ctx.length);
          } catch (e) {
            console.error("ai stream broke", st.model, String((e as Error).message || e).slice(0, 200));
            await refund();
            send({ error: "fail" });
          } finally { clearTimeout(kill); c.close(); }
        },
      });
      return new Response(stream, { headers: { ...cors, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
    }
    let out: { text: string; model: string };
    try { out = await gemini(key, system, contents, wantJson, tool === "shiftsheet" ? 15000 : 6000); }
    catch (e) { await refund(); throw e; }
    console.log("ai ok", tool, out.model, Date.now() - t0, "ms", "context", ctx.length);
    if (wantJson) {
      let parsed: unknown = null;
      try { parsed = JSON.parse(out.text.replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch (_) { /* fall through */ }
      if (!parsed) { await refund(); return json({ error: "parse" }, 502); }
      return json({ data: parsed, left });
    }
    return json({ text: out.text, left });
  } catch (e) {
    const msg = String((e as Error).message || e);
    console.error("ai error", msg);
    return json({ error: /^429|timeout/.test(msg) ? "busy" : "fail" }, 502);
  }
});
