package io.github.smkrot3sudo.budget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.view.View;
import android.widget.RemoteViews;

/**
 * Home-screen widget: today's allowed amount as the page last computed it, a "+" that opens a new expense,
 * and a line when card payments are waiting to be logged.
 */
public class BudgetWidget extends AppWidgetProvider {
    private static SharedPreferences prefs(Context c) { return c.getSharedPreferences("widget", Context.MODE_PRIVATE); }

    /** Called from the page each time it works out today's number. */
    static void set(Context c, String label, String value) {
        prefs(c).edit().putString("label", label == null ? "" : label).putString("value", value == null ? "" : value)
            .putLong("at", System.currentTimeMillis()).apply();
        refresh(c);
    }

    static void refresh(Context c) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        int[] ids = m.getAppWidgetIds(new ComponentName(c, BudgetWidget.class));
        if (ids.length > 0) for (int id : ids) m.updateAppWidget(id, views(c));
    }

    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        for (int id : ids) m.updateAppWidget(id, views(c));
    }

    private static PendingIntent open(Context c, String what, int code) {
        Intent i = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (what != null) i.putExtra(MainActivity.EXTRA_OPEN, what);
        return PendingIntent.getActivity(c, code, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private static RemoteViews views(Context c) {
        SharedPreferences p = prefs(c);
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget);
        String value = p.getString("value", "");
        long at = p.getLong("at", 0);
        boolean today = at > 0 && android.text.format.DateUtils.isToday(at);
        v.setTextViewText(R.id.wLabel, value.isEmpty() ? "התקציב שלי" : today ? p.getString("label", "מותר לך להוציא היום") : "פתח כדי לעדכן");
        v.setTextViewText(R.id.wValue, value.isEmpty() || !today ? "—" : value);
        int waiting = PayListener.pending(c).length();
        v.setViewVisibility(R.id.wPay, waiting > 0 ? View.VISIBLE : View.GONE);
        v.setTextViewText(R.id.wPay, waiting == 1 ? "💳 תשלום אחד מחכה לרישום" : "💳 " + waiting + " תשלומים מחכים לרישום");
        v.setOnClickPendingIntent(R.id.wBody, open(c, waiting > 0 ? "pay" : null, 31));
        v.setOnClickPendingIntent(R.id.wAdd, open(c, "add", 32));
        return v;
    }
}
