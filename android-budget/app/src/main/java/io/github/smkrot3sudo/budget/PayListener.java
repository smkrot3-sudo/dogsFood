package io.github.smkrot3sudo.budget;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Reads the phone's notifications (only after the user turns it on in Android settings) and keeps the ones that look
 * like a card or bank charge as "payments waiting", so the page can offer a ready expense to approve. Nothing leaves
 * the phone: the list lives in this app's private storage and the page reads it through the bridge.
 */
public class PayListener extends NotificationListenerService {
    // A new channel id: the old one was silent (low importance), and a channel's importance can't change once made
    private static final String CHANNEL = "budget-pay2";
    private static final long DAY = 24L * 3600 * 1000;

    static boolean enabled(Context c) {
        String on = Settings.Secure.getString(c.getContentResolver(), "enabled_notification_listeners");
        return on != null && on.contains(new ComponentName(c, PayListener.class).flattenToString());
    }

    static void openSettings(Context c) {
        Intent i = new Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try { c.startActivity(i); }
        catch (Exception e) {
            // Some phones lack that screen; the app's own settings page is the next best place
            try { c.startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:" + c.getPackageName())).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); }
            catch (Exception e2) { /* nothing to open */ }
        }
    }

    private static SharedPreferences prefs(Context c) { return c.getSharedPreferences("pay", Context.MODE_PRIVATE); }

    static synchronized JSONArray pending(Context c) {
        JSONArray in, out = new JSONArray();
        try { in = new JSONArray(prefs(c).getString("list", "[]")); } catch (Exception e) { in = new JSONArray(); }
        long now = System.currentTimeMillis();
        for (int i = 0; i < in.length(); i++) {
            JSONObject p = in.optJSONObject(i);
            if (p != null && now - p.optLong("at") < 14 * DAY) out.put(p);
        }
        return out;
    }

    static synchronized void done(Context c, String id) {
        JSONArray l = pending(c), keep = new JSONArray();
        for (int i = 0; i < l.length(); i++) { JSONObject p = l.optJSONObject(i); if (!p.optString("id").equals(id)) keep.put(p); }
        prefs(c).edit().putString("list", keep.toString()).apply();
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        nm.cancel(id.hashCode() & 0x7fffff | 0x1000000);
        BudgetWidget.refresh(c);
    }

    @Override
    public void onListenerConnected() { prefs(this).edit().putLong("connectedAt", System.currentTimeMillis()).apply(); }

    @Override
    public void onListenerDisconnected() {
        // Android (or the phone maker's battery saver) dropped the connection: ask to be connected again
        if (Build.VERSION.SDK_INT >= 24) try { requestRebind(new ComponentName(this, PayListener.class)); } catch (Exception e) { /* try on next app open */ }
    }

    /** Ask Android to reconnect the listener (after an update or a battery saver drops it). Called when the app opens. */
    static void rebind(Context c) {
        if (Build.VERSION.SDK_INT >= 24 && enabled(c)) try { requestRebind(new ComponentName(c, PayListener.class)); } catch (Exception e) { /* nothing to do */ }
    }

    /** For the settings screen: is the listener really receiving notifications, and what happened to the last one (no content). */
    static String status(Context c) {
        SharedPreferences p = prefs(c);
        try {
            return new JSONObject().put("connectedAt", p.getLong("connectedAt", 0)).put("seenAt", p.getLong("seenAt", 0)).put("seen", p.getInt("seen", 0))
                .put("lastApp", p.getString("lastApp", "")).put("lastResult", p.getString("lastResult", "")).toString();
        } catch (Exception e) { return "{}"; }
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        String pkg = sbn.getPackageName(), result;
        if (pkg.equals(getPackageName())) return;
        try { result = take(sbn); } catch (Exception e) { result = "error"; /* a notification we can't read is simply skipped */ }
        String app = pkg;
        try { app = getPackageManager().getApplicationLabel(getPackageManager().getApplicationInfo(pkg, 0)).toString(); } catch (Exception e) { /* keep the package name */ }
        SharedPreferences p = prefs(this);
        p.edit().putLong("seenAt", System.currentTimeMillis()).putInt("seen", p.getInt("seen", 0) + 1).putString("lastApp", app).putString("lastResult", result).apply();
    }

    private String take(StatusBarNotification sbn) throws Exception {
        String pkg = sbn.getPackageName();
        Notification n = sbn.getNotification();
        if ((n.flags & Notification.FLAG_GROUP_SUMMARY) != 0 || (n.flags & Notification.FLAG_ONGOING_EVENT) != 0) return "summary";
        Bundle x = n.extras;
        String title = str(x.getCharSequence(Notification.EXTRA_TITLE));
        String body = str(x.getCharSequence(Notification.EXTRA_BIG_TEXT));
        if (body.isEmpty()) body = str(x.getCharSequence(Notification.EXTRA_TEXT));
        PayParse r = PayParse.parse(pkg, title, body);
        if (!"ok".equals(r.result)) return r.result;
        double amount = r.amount;
        String cur = r.cur, merchant = r.merchant, all = r.text;

        long now = System.currentTimeMillis();
        // The same charge often comes twice (bank + card app, or an updated notification): one entry per amount per 15 minutes
        String key = String.format(java.util.Locale.US, "%s%.2f/%d", cur, amount, now / (15 * 60 * 1000));
        SharedPreferences p = prefs(this);
        if (key.equals(p.getString("lastKey", ""))) return "duplicate";

        String app = pkg;
        try { app = getPackageManager().getApplicationLabel(getPackageManager().getApplicationInfo(pkg, 0)).toString(); } catch (Exception e) { /* keep the package name */ }
        String id = "p" + now;
        JSONObject item = new JSONObject().put("id", id).put("at", now).put("amount", amount).put("cur", cur).put("merchant", merchant)
            .put("app", app).put("text", all.length() > 200 ? all.substring(0, 200) : all);
        synchronized (PayListener.class) {
            JSONArray l = pending(this), out = new JSONArray();
            out.put(item);
            for (int i = 0; i < l.length() && out.length() < 30; i++) out.put(l.get(i));
            p.edit().putString("list", out.toString()).putString("lastKey", key).apply();
        }
        BudgetWidget.refresh(this);
        notifyFound(this, id, amount, cur, merchant);
        return "taken";
    }

    private static String str(CharSequence s) { return s == null ? "" : s.toString().trim(); }

    private static void notifyFound(Context c, String id, double amount, String cur, String merchant) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null)
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "תשלומים שזוהו", NotificationManager.IMPORTANCE_DEFAULT));
        String sign = "ILS".equals(cur) ? "₪" : "USD".equals(cur) ? "$" : "EUR".equals(cur) ? "€" : "GBP".equals(cur) ? "£" : cur + " ";
        String amt = sign + (amount == Math.floor(amount) ? String.valueOf((long) amount) : String.format(java.util.Locale.US, "%.2f", amount));
        Intent open = new Intent(c, MainActivity.class).putExtra(MainActivity.EXTRA_OPEN, "pay:" + id)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent openPi = PendingIntent.getActivity(c, id.hashCode(), open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent skipPi = PendingIntent.getBroadcast(c, id.hashCode(), new Intent(c, Skip.class).putExtra("id", id),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, CHANNEL) : new Notification.Builder(c);
        b.setSmallIcon(R.drawable.ic_note)
            .setContentTitle("💳 " + amt + (merchant.isEmpty() ? "" : " · " + merchant))
            .setContentText("לחיצה פותחת הוצאה מוכנה לרישום")
            .setContentIntent(openPi)
            .setAutoCancel(true)
            .addAction(new Notification.Action.Builder(null, "✓ לרשום", openPi).build())
            .addAction(new Notification.Action.Builder(null, "זו לא הוצאה", skipPi).build());
        try { nm.notify(id.hashCode() & 0x7fffff | 0x1000000, b.build()); } catch (SecurityException e) { /* notifications not allowed */ }
    }

    /** "זו לא הוצאה" from the notification drops it from the waiting list. */
    public static class Skip extends BroadcastReceiver {
        @Override
        public void onReceive(Context c, Intent i) {
            String id = i.getStringExtra("id");
            if (id != null) done(c, id);
        }
    }
}
