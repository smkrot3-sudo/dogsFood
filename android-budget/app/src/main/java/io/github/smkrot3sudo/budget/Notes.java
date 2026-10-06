package io.github.smkrot3sudo.budget;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Notifications the page asks for: one right away (a category went over budget), or scheduled ones such as
 * the weekly summary after Shabbat. Each scheduled note is {id, at (ms), title, text, every (days, optional)}.
 */
public class Notes extends BroadcastReceiver {
    static final String ACTION = "io.github.smkrot3sudo.budget.NOTE";
    private static final String CHANNEL = "budget-updates";
    private static final long DAY = 24L * 3600 * 1000;

    private static SharedPreferences prefs(Context c) { return c.getSharedPreferences("notes", Context.MODE_PRIVATE); }

    private static JSONArray list(Context c) {
        try { return new JSONArray(prefs(c).getString("list", "[]")); } catch (Exception e) { return new JSONArray(); }
    }

    /** Replaces the scheduled notes with the page's list. */
    static void set(Context c, String json) {
        JSONArray in;
        try { in = new JSONArray(json == null ? "[]" : json); } catch (Exception e) { return; }
        JSONArray out = new JSONArray();
        for (int i = 0; i < in.length() && i < 20; i++) {
            JSONObject n = in.optJSONObject(i);
            if (n == null || n.optLong("at", 0) <= 0 || n.optString("title", "").isEmpty()) continue;
            out.put(n);
        }
        prefs(c).edit().putString("list", out.toString()).apply();
        schedule(c);
    }

    static void schedule(Context c) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pi = PendingIntent.getBroadcast(c, 5, new Intent(c, Notes.class).setAction(ACTION),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        am.cancel(pi);
        JSONArray l = list(c);
        long next = Long.MAX_VALUE;
        for (int i = 0; i < l.length(); i++) next = Math.min(next, l.optJSONObject(i).optLong("at"));
        if (next != Long.MAX_VALUE) am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, Math.max(next, System.currentTimeMillis() + 1000), pi);
    }

    @Override
    public void onReceive(Context c, Intent i) {
        if (ACTION.equals(i.getAction())) {
            long now = System.currentTimeMillis();
            JSONArray l = list(c), keep = new JSONArray();
            for (int k = 0; k < l.length(); k++) {
                JSONObject n = l.optJSONObject(k);
                long at = n.optLong("at");
                if (at <= now + 60000) {
                    // Show it only if it isn't stale (the phone was off for days)
                    if (now - at < DAY) show(c, n.optString("title"), n.optString("text"), 200 + Math.abs(n.optString("id").hashCode() % 1000));
                    int every = n.optInt("every", 0);
                    if (every > 0) {
                        while (at <= now + 60000) at += every * DAY;
                        try { n.put("at", at); } catch (Exception e) { continue; }
                        keep.put(n);
                    }
                } else keep.put(n);
            }
            prefs(c).edit().putString("list", keep.toString()).apply();
        }
        // Also after a restart or an app update, when alarms are cleared
        schedule(c);
    }

    static void show(Context c, String title, String text, int id) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null)
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "עדכונים על התקציב", NotificationManager.IMPORTANCE_DEFAULT));
        Intent open = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent openPi = PendingIntent.getActivity(c, 6, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, CHANNEL) : new Notification.Builder(c);
        b.setSmallIcon(R.drawable.ic_note)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(new Notification.BigTextStyle().bigText(text))
            .setContentIntent(openPi)
            .setAutoCancel(true);
        try { nm.notify(id, b.build()); } catch (SecurityException e) { /* notifications not allowed */ }
    }
}
