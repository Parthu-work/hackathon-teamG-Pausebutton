package ai.apty.pausebutton;

import androidx.annotation.NonNull;

import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;

/**
 * Push for the Android app (Firebase Cloud Messaging), with the app closed,
 * in the background or open. The server sends data-only messages, so Android
 * never shows anything by itself: this builds the notification (Alerts), then
 * posts the receipt the browser's service worker would. Replaces the
 * push-notifications plugin's own service (removed in the manifest), which
 * it extends, so the web app still hears about messages and new tokens while
 * it is open.
 */
public class PauseMessagingService extends MessagingService {
    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        super.onMessageReceived(message); // to the web app, when it is open
        PushAlert alert = PushAlert.from(message.getData());
        // Already on a background thread, so the receipt goes out here.
        Alerts.receipt(alert, Alerts.show(this, alert));
    }
}
