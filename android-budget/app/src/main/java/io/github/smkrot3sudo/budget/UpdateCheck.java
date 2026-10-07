package io.github.smkrot3sudo.budget;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Calendar;

/**
 * Every few hours, even when the app is closed, looks at app-version.json on the site and shows a phone
 * notification once for each new version. Quiet at night and over Shabbat; it shows on the next check after.
 */
public class UpdateCheck extends BroadcastReceiver {
    static final String ACTION = "io.github.smkrot3sudo.budget.UPDATE_CHECK";
    private static final String URL_JSON = "https://smkrot3-sudo.github.io/dogsFood/budget/app-version.json";
    private static final long EVERY = 3 * AlarmManager.INTERVAL_HOUR;

    static void schedule(Context c) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pi = PendingIntent.getBroadcast(c, 7, new Intent(c, UpdateCheck.class).setAction(ACTION),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        am.cancel(pi);
        am.setInexactRepeating(AlarmManager.RTC_WAKEUP, System.currentTimeMillis() + 15 * 60 * 1000, EVERY, pi);
    }

    @Override
    public void onReceive(Context c, Intent i) {
        if (!ACTION.equals(i.getAction())) { schedule(c); return; }
        final PendingResult done = goAsync();
        final Context app = c.getApplicationContext();
        new Thread(() -> {
            try { check(app); } catch (Exception e) { /* offline: try again next time */ }
            try { checkMessages(app); } catch (Exception e) { /* offline: try again next time */ }
            finally { done.finish(); }
        }).start();
    }

    private static boolean quietNow() {
        Calendar n = Calendar.getInstance();
        int h = n.get(Calendar.HOUR_OF_DAY), d = n.get(Calendar.DAY_OF_WEEK);
        if (h < 9 || h >= 22) return true;
        return (d == Calendar.FRIDAY && h >= 14) || (d == Calendar.SATURDAY && h < 21);
    }

    private static String get(String url, String key) throws Exception {
        HttpURLConnection con = (HttpURLConnection) new URL(url).openConnection();
        con.setConnectTimeout(15000);
        con.setReadTimeout(15000);
        con.setUseCaches(false);
        if (key != null) { con.setRequestProperty("apikey", key); con.setRequestProperty("Authorization", "Bearer " + key); }
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        try (InputStream in = con.getInputStream()) {
            byte[] b = new byte[4096];
            for (int n; (n = in.read(b)) > 0; ) buf.write(b, 0, n);
        } finally { con.disconnect(); }
        return buf.toString("UTF-8");
    }

    // The owner's message to everyone, sent from the admin page with "also as a notification"
    private static final String MSG_URL = "https://iteswfqwzbtpsjfwcptr.supabase.co/rest/v1/broadcasts?select=id,body,created_at&push=eq.true&active=eq.true&order=id.desc&limit=1";
    private static final String ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0ZXN3ZnF3emJ0cHNqZndjcHRyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA3MDcwMTQsImV4cCI6MjEwNjI4MzAxNH0.7pjYPBQzvl54BCthc0iY4AT7yW0MfO0pUvPN0s1iirs";

    private static void checkMessages(Context c) throws Exception {
        if (quietNow()) return;
        org.json.JSONArray a = new org.json.JSONArray(get(MSG_URL, ANON));
        if (a.length() == 0) return;
        JSONObject m = a.getJSONObject(0);
        long id = m.optLong("id");
        SharedPreferences p = c.getSharedPreferences("update-check", Context.MODE_PRIVATE);
        if (id <= p.getLong("msg", 0)) return;
        p.edit().putLong("msg", id).apply();
        // Only fresh messages: a phone that comes online after a week doesn't get old news
        long at = 0;
        try {
            java.text.SimpleDateFormat f = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", java.util.Locale.US);
            f.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
            at = f.parse(m.optString("created_at").substring(0, 19)).getTime();
        } catch (Exception e) { at = System.currentTimeMillis(); }
        if (System.currentTimeMillis() - at > 3L * 24 * 3600 * 1000) return;
        Notes.show(c, "📣 הודעה מ״התקציב שלי״", m.optString("body"), 400);
    }

    private static void check(Context c) throws Exception {
        if (quietNow()) return;
        HttpURLConnection con = (HttpURLConnection) new URL(URL_JSON + "?t=" + System.currentTimeMillis()).openConnection();
        con.setConnectTimeout(15000);
        con.setReadTimeout(15000);
        con.setUseCaches(false);
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        try (InputStream in = con.getInputStream()) {
            byte[] b = new byte[4096];
            for (int n; (n = in.read(b)) > 0; ) buf.write(b, 0, n);
        } finally { con.disconnect(); }
        JSONObject v = new JSONObject(buf.toString("UTF-8"));
        int code = v.optInt("versionCode", 0);
        SharedPreferences p = c.getSharedPreferences("update-check", Context.MODE_PRIVATE);
        if (code <= BuildConfigVersion.CODE || code <= p.getInt("told", 0)) return;
        String notes = v.optString("notes", "");
        Notes.show(c, "📲 יש עדכון לאפליקציה (" + v.optString("versionName") + ")",
            (notes.isEmpty() ? "" : notes + ". ") + "לחיצה פותחת את האפליקציה, ושם לוחצים \"עדכון\".", 300);
        p.edit().putInt("told", code).apply();
    }
}
