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

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * The daily "did you log your shift?" reminder. It fires at the chosen time unless the page already
 * reported a shift (or "didn't work") for today. Its two buttons open the new-shift form or mark the day off.
 */
public class Reminder extends BroadcastReceiver {
    static final String ACTION_FIRE = "io.github.smkrot3sudo.budget.REMIND";
    static final String ACTION_OFF = "io.github.smkrot3sudo.budget.DAY_OFF";
    static final String EXTRA_DATE = "date";
    private static final String CHANNEL = "shift-reminder";
    private static final int NOTE_ID = 22;

    private static SharedPreferences prefs(Context c) { return c.getSharedPreferences("reminder", Context.MODE_PRIVATE); }

    static String today() { return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date()); }

    /** Turns the reminder on at hh:mm (or off), and schedules the next one. */
    static void set(Context c, boolean on, String time) {
        prefs(c).edit().putBoolean("on", on).putString("time", time).apply();
        schedule(c);
    }

    static boolean isOn(Context c) { return prefs(c).getBoolean("on", false); }

    static String time(Context c) { return prefs(c).getString("time", "22:30"); }

    /** Dates (yyyy-MM-dd) the page says already have a shift or are marked as a day off. */
    static void setDoneDays(Context c, String csv) {
        Set<String> s = new HashSet<>();
        if (csv != null) for (String d : csv.split(",")) if (d.trim().length() == 10) s.add(d.trim());
        s.addAll(offDays(c));
        prefs(c).edit().putStringSet("done", s).apply();
        if (s.contains(today())) cancel(c);
    }

    /** Days marked "didn't work" from the notification, waiting for the page to pick them up. */
    static Set<String> offDays(Context c) { return new HashSet<>(prefs(c).getStringSet("off", new HashSet<>())); }

    static String takeOffDays(Context c) {
        Set<String> s = offDays(c);
        prefs(c).edit().remove("off").apply();
        return android.text.TextUtils.join(",", s);
    }

    static void schedule(Context c) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pi = PendingIntent.getBroadcast(c, 1, new Intent(c, Reminder.class).setAction(ACTION_FIRE),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        am.cancel(pi);
        if (!isOn(c)) return;
        String[] hm = time(c).split(":");
        Calendar at = Calendar.getInstance();
        at.set(Calendar.HOUR_OF_DAY, Integer.parseInt(hm[0]));
        at.set(Calendar.MINUTE, Integer.parseInt(hm[1]));
        at.set(Calendar.SECOND, 0);
        at.set(Calendar.MILLISECOND, 0);
        if (at.getTimeInMillis() <= System.currentTimeMillis() + 1000) at.add(Calendar.DAY_OF_MONTH, 1);
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at.getTimeInMillis(), pi);
    }

    static void cancel(Context c) {
        ((NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE)).cancel(NOTE_ID);
    }

    @Override
    public void onReceive(Context c, Intent i) {
        String a = i.getAction();
        if (ACTION_OFF.equals(a)) {
            String d = i.getStringExtra(EXTRA_DATE);
            if (d != null) {
                Set<String> off = offDays(c); off.add(d);
                Set<String> done = new HashSet<>(prefs(c).getStringSet("done", new HashSet<>())); done.add(d);
                prefs(c).edit().putStringSet("off", off).putStringSet("done", done).apply();
            }
            cancel(c);
            return;
        }
        if (ACTION_FIRE.equals(a)) {
            schedule(c); // tomorrow's
            if (isOn(c) && !prefs(c).getStringSet("done", new HashSet<>()).contains(today())) show(c, today());
            return;
        }
        // Boot or app update: alarms are cleared, set the next one again
        schedule(c);
    }

    private static void show(Context c, String date) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null)
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "תזכורת משמרת", NotificationManager.IMPORTANCE_HIGH));

        Intent open = new Intent(c, MainActivity.class).putExtra(MainActivity.EXTRA_SHIFT_DATE, date)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent openPi = PendingIntent.getActivity(c, 2, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent offPi = PendingIntent.getBroadcast(c, 3,
            new Intent(c, Reminder.class).setAction(ACTION_OFF).putExtra(EXTRA_DATE, date),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(c, CHANNEL) : new Notification.Builder(c);
        b.setSmallIcon(R.drawable.ic_note)
            .setContentTitle("⏰ עבדת היום?")
            .setContentText("הזן את שעות המשמרת של היום כל עוד אתה זוכר אותן.")
            .setContentIntent(openPi)
            .setAutoCancel(true)
            .addAction(new Notification.Action.Builder(null, "✍️ הכנס משמרת", openPi).build())
            .addAction(new Notification.Action.Builder(null, "🏖️ לא עבדתי היום", offPi).build());
        if (Build.VERSION.SDK_INT < 26) b.setPriority(Notification.PRIORITY_HIGH);
        try { nm.notify(NOTE_ID, b.build()); } catch (SecurityException e) { /* notifications not allowed */ }
    }
}
