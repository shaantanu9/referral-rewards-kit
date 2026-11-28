import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, StyleSheet, Switch, Text, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import {
  displayNameProblem,
  ReferralCopy,
  ReferralEvent,
  ReferralEventName,
  ReferralTerms,
  reportReferralEvent,
  type ReferralClient,
  type ReferralEventSink,
  type ReferralKitLocalizations,
  type ReferralPreferences,
} from '@myind/referral-core';
import { useReferralKit } from '../context';
import { Button, LiveText, minTarget, type } from '../ui/primitives';

export interface ReferralInvitePageSettingsProps {
  client: ReferralClient;
  /** Already loaded preferences (the invite screen loads them with the code); loaded here when not given. */
  initialPreferences?: ReferralPreferences | null;
  /** The terms reward the sharer: the friend's page says "{Name} gets a reward if you join". Default true. */
  sharerRewarded?: boolean;
  /** Runs after leaving was saved (the invite screen reloads into its "You left" state). */
  onLeft?: () => void;
  onEvent?: ReferralEventSink;
  /** Asks before leaving; default a native `Alert` with Cancel / Leave. Resolve true to leave. */
  confirmLeave?: (l10n: ReferralKitLocalizations) => Promise<boolean>;
  style?: StyleProp<ViewStyle>;
}

/** The native "Leave the invite program?" dialog. */
export function alertConfirmLeave(l10n: ReferralKitLocalizations): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      l10n.leaveConfirmTitle,
      l10n.leaveConfirmBody,
      [
        { text: l10n.cancel, style: 'cancel', onPress: () => resolve(false) },
        { text: l10n.leaveConfirm, style: 'destructive', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

/**
 * "Your invite page" (G7, G9): the sharer's opt-in to show their first name on the invite page, what the friend
 * sees, and "Leave the invite program" with a confirm. Shows nothing on a server without `referral_preferences` or
 * when it cannot load. Turning the name off is saved at once; turning it on waits for the name.
 */
export function ReferralInvitePageSettings(props: ReferralInvitePageSettingsProps): ReactNode {
  const { l10n, theme } = useReferralKit();
  const alive = useRef(true);
  const [prefs, setPrefs] = useState<ReferralPreferences | null>(props.initialPreferences ?? null);
  const [showName, setShowName] = useState(props.initialPreferences?.showName ?? false);
  const [name, setName] = useState(props.initialPreferences?.displayName ?? '');
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    alive.current = true;
    if (props.initialPreferences == null) {
      props.client
        .preferences()
        .then((p) => {
          if (!alive.current) return;
          setPrefs(p);
          setShowName(p.showName);
          setName(p.displayName ?? '');
        })
        .catch(() => {
          // Older server or offline: the block stays hidden.
        });
    }
    return () => {
      alive.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emit = (p: Record<string, string | boolean>): void =>
    reportReferralEvent(props.onEvent ?? props.client.onEvent, new ReferralEvent(ReferralEventName.invitePreferencesChanged, p));

  const save = async (opts: { showName?: boolean; displayName?: string; participating?: boolean }): Promise<ReferralPreferences | null> => {
    setSaving(true);
    setStatus(null);
    const p0: Record<string, boolean> = {};
    if (opts.showName !== undefined) p0['show_name'] = opts.showName;
    if (opts.participating !== undefined) p0['participating'] = opts.participating;
    try {
      const p = await props.client.setPreferences(opts);
      emit({ ...p0, result: p.reason ?? 'ok' });
      if (alive.current) {
        if (p.isOk) {
          setPrefs(p);
          setShowName(p.showName);
          if (p.displayName != null) setName(p.displayName);
          setStatus(l10n.saved);
        } else if (p.reason === 'invalid_name') {
          setNameError(l10n.nameErrEmailOrLink);
        } else {
          setStatus(l10n.errUnavailable);
        }
      }
      return p;
    } catch {
      emit({ ...p0, result: 'failed' });
      if (alive.current) setStatus(l10n.saveFailed);
      return null;
    } finally {
      if (alive.current) setSaving(false);
    }
  };

  const saveName = async (): Promise<void> => {
    if (showName) {
      const error = new ReferralCopy({ l10n, terms: ReferralTerms.none }).displayNameError(displayNameProblem(name));
      setNameError(error);
      if (error != null) return;
      await save({ showName: true, displayName: name });
    } else {
      await save({ showName: false });
    }
  };

  const toggle = async (on: boolean): Promise<void> => {
    setShowName(on);
    setNameError(null);
    setStatus(null);
    // Withdrawing is as easy as opting in: off is saved at once.
    if (!on) await save({ showName: false });
  };

  const leave = async (): Promise<void> => {
    const yes = await (props.confirmLeave ?? alertConfirmLeave)(l10n);
    if (!yes || !alive.current) return;
    const p = await save({ participating: false });
    if (p != null && p.isOk) props.onLeft?.();
  };

  if (prefs == null) return null;
  const dirty = showName !== prefs.showName || (showName && name.trim() !== (prefs.displayName ?? ''));
  const muted = [type.bodyMedium, { color: theme.onSurfaceVariant }];
  return (
    <View testID="referral-invite-page" style={props.style}>
      <Text accessibilityRole="header" style={[type.titleSmall, { color: theme.onSurface }]}>
        {l10n.invitePageTitle}
      </Text>
      <View style={styles.switchRow}>
        <Text style={[type.bodyLarge, styles.flex, { color: theme.onSurface }]}>{l10n.showFirstName}</Text>
        <Switch
          testID="referral-show-name"
          accessibilityLabel={l10n.showFirstName}
          value={showName}
          disabled={saving}
          onValueChange={(v) => void toggle(v)}
          trackColor={{ true: theme.primary, false: theme.outline }}
        />
      </View>
      <Text style={muted}>{props.sharerRewarded ?? true ? l10n.invitePageExplainRewarded : l10n.invitePageExplain}</Text>
      {showName ? (
        <View style={styles.m12}>
          <TextInput
            testID="referral-name-field"
            accessibilityLabel={l10n.firstNameLabel}
            placeholder={l10n.firstNameLabel}
            placeholderTextColor={theme.onSurfaceVariant}
            value={name}
            editable={!saving}
            autoCapitalize="words"
            autoComplete="given-name"
            textContentType="givenName"
            onChangeText={(v) => {
              setName(v);
              setNameError(null);
              setStatus(null);
            }}
            onSubmitEditing={() => void saveName()}
            style={[type.bodyLarge, styles.field, { color: theme.onSurface, borderColor: nameError ? theme.error : theme.outline }]}
          />
          {nameError != null ? (
            <LiveText testID="referral-name-error" style={[type.bodySmall, styles.m4, { color: theme.error }]}>
              {nameError}
            </LiveText>
          ) : null}
        </View>
      ) : null}
      {dirty ? (
        <View style={[styles.end, styles.m8]}>
          <Button theme={theme} testID="referral-name-save" label={l10n.save} disabled={saving} onPress={() => void saveName()} />
        </View>
      ) : null}
      {status != null ? (
        <LiveText testID="referral-prefs-status" style={[muted, styles.m8]}>
          {status}
        </LiveText>
      ) : null}
      <View style={[styles.startAlign, styles.m8]}>
        <Button
          theme={theme}
          variant="text"
          color={theme.error}
          testID="referral-leave"
          label={l10n.leaveProgram}
          disabled={saving}
          onPress={() => void leave()}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  switchRow: { flexDirection: 'row', alignItems: 'center', minHeight: minTarget + 4, gap: 12 },
  flex: { flex: 1 },
  field: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 12, paddingVertical: 10, minHeight: 52 },
  end: { alignItems: 'flex-end' },
  startAlign: { alignItems: 'flex-start' },
  m4: { marginTop: 4 },
  m8: { marginTop: 8 },
  m12: { marginTop: 12 },
});
