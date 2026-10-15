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
    private static final String CHANNEL = "budget-pay";
    private static final long DAY = 24L * 3600 * 1000;

    // Chat and text-message apps are skipped: the owner chose notifications from payment apps only, not SMS
    private static final Set<String> SKIP = new HashSet<>(Arrays.asList(
        "com.whatsapp", "com.whatsapp.w4b", "org.telegram.messenger", "com.facebook.orca", "com.google.android.gm",
        "com.google.android.apps.messaging", "com.samsung.android.messaging", "com.android.mms", "com.android.messaging",
        "com.microsoft.office.outlook", "com.instagram.android"));

    private static final Pattern AMOUNT = Pattern.compile(
        "(?:₪|ש\"ח|ש״ח|ILS|NIS)\\s?([0-9][0-9,]*(?:\\.[0-9]{1,2})?)|([0-9][0-9,]*(?:\\.[0-9]{1,2})?)\\s?(?:₪|ש\"ח|ש״ח|ILS|NIS|שקל)");
    private static final Pattern PAID = Pattern.compile(
        "חיוב|חויב|עסק[הת]|רכישה|רכשת|שולם|שילמת|תשלום|אושר|בוצע|העברת|charged|payment|purchase|paid|spent|transaction", Pattern.CASE_INSENSITIVE);
    private static final Pattern INCOMING = Pattern.compile(
        "זיכוי|זוכה|החזר|קיבלת|הועבר[וה]? אליך|העביר לך|העבירה לך|refund|received|credited", Pattern.CASE_INSENSITIVE);
    private static final Pattern MERCHANT = Pattern.compile(
        "(?:בבית העסק|בבית עסק|אצל|ב־|ב-|at )\\s*([^,.\\n:;]{2,40}?)(?=\\s*(?:בסך|בסכום|בתאריך|ביום|על סך|,|\\.|$|\\n|₪|[0-9]))");

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
    public void onNotificationPosted(StatusBarNotification sbn) {
        try { take(sbn); } catch (Exception e) { /* a notification we can't read is simply skipped */ }
    }

    private void take(StatusBarNotification sbn) throws Exception {
        String pkg = sbn.getPackageName();
        if (pkg.equals(getPackageName()) || SKIP.contains(pkg)) return;
        Notification n = sbn.getNotification();
        if ((n.flags & Notification.FLAG_GROUP_SUMMARY) != 0 || (n.flags & Notification.FLAG_ONGOING_EVENT) != 0) return;
        Bundle x = n.extras;
        String title = str(x.getCharSequence(Notification.EXTRA_TITLE));
        String body = str(x.getCharSequence(Notification.EXTRA_BIG_TEXT));
        if (body.isEmpty()) body = str(x.getCharSequence(Notification.EXTRA_TEXT));
        String all = (title + "\n" + body).trim();
        if (all.length() > 600) all = all.substring(0, 600);
        if (!PAID.matcher(all).find() || INCOMING.matcher(all).find()) return;
        Matcher m = AMOUNT.matcher(all);
        if (!m.find()) return;
        double amount = Double.parseDouble((m.group(1) != null ? m.group(1) : m.group(2)).replace(",", ""));
        if (!(amount > 0) || amount > 100000) return;

        String merchant = "";
        Matcher mm = MERCHANT.matcher(body.isEmpty() ? all : body);
        if (mm.find()) merchant = mm.group(1).trim();

        long now = System.currentTimeMillis();
        // The same charge often comes twice (bank + card app, or an updated notification): one entry per amount per 15 minutes
        String key = String.format(java.util.Locale.US, "%.2f/%d", amount, now / (15 * 60 * 1000));
        SharedPreferences p = prefs(this);
        if (key.equals(p.getString("lastKey", ""))) return;

        String app = pkg;
        try { app = getPackageManager().getApplicationLabel(getPackageManager().getApplicationInfo(pkg, 0)).toString(); } catch (Exception e) { /* keep the package name */ }
        String id = "p" + now;
        JSONObject item = new JSONObject().put("id", id).put("at", now).put("amount", amount).put("merchant", merchant)
            .put("app", app).put("text", all.length() > 200 ? all.substring(0, 200) : all);
        synchronized (PayListener.class) {
            JSONArray l = pending(this), out = new JSONArray();
            out.put(item);
            for (int i = 0; i < l.length() && out.length() < 30; i++) out.put(l.get(i));
            p.edit().putString("list", out.toString()).putString("lastKey", key).apply();
        }
        BudgetWidget.refresh(this);
        notifyFound(this, id, amount, merchant);
    }

    private static String str(CharSequence s) { return s == null ? "" : s.toString().trim(); }

    private static void notifyFound(Context c, String id, double amount, String merchant) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null)
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "תשלומים שזוהו", NotificationManager.IMPORTANCE_LOW));
        String amt = "₪" + (amount == Math.floor(amount) ? String.valueOf((long) amount) : String.format(java.util.Locale.US, "%.2f", amount));
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
