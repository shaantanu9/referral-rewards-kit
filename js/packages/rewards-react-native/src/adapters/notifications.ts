/**
 * `@myind/rewards-react-native/notifications`: the follow-up reminders on the device through `expo-notifications`
 * (`npx expo install expo-notifications`). The engine plans them; `FollowupScheduler` keeps the device in step; this
 * adapter only schedules and cancels. Ask for permission yourself, at a moment that makes sense to the user
 * (`Notifications.requestPermissionsAsync()`), and set a handler (`setNotificationHandler`) so they show in the
 * foreground.
 */
import * as Notifications from 'expo-notifications';
import type { FollowupNotifier } from '@myind/rewards-core';

/** The part of expo-notifications the notifier uses (inject a double in tests). */
export interface ExpoNotificationsLike {
  scheduleNotificationAsync(request: Notifications.NotificationRequestInput): Promise<string>;
  cancelScheduledNotificationAsync(identifier: string): Promise<void>;
}

/**
 * A `FollowupNotifier` on expo-notifications: each plan item becomes a one-off date notification whose identifier is
 * the item id (so scheduling the same id again replaces it), with `data.payload` set to the item's payload (pass it
 * to `controller.followupOpened(program)` when the user taps it). [channelId]: an Android channel you created.
 */
export function expoNotifier(opts: { channelId?: string; notifications?: ExpoNotificationsLike } = {}): FollowupNotifier {
  const n = opts.notifications ?? Notifications;
  return {
    async cancel(ids) {
      for (const id of ids) {
        try {
          await n.cancelScheduledNotificationAsync(String(id));
        } catch {
          // Already gone.
        }
      }
    },
    async schedule(item) {
      await n.scheduleNotificationAsync({
        identifier: String(item.id),
        content: { title: item.title, body: item.body, data: { payload: item.payload } },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: item.at,
          ...(opts.channelId ? { channelId: opts.channelId } : {}),
        },
      });
    },
  };
}
