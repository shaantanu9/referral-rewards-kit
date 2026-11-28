import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import {
  QuizController,
  QuizPhase,
  QuizQuestionKind,
  QuizStatus,
  type QuizState,
  type RewardsController,
  type RewardsTexts,
} from '@myind/rewards-core';
import { useQuiz, useRewardsKit } from '../context';
import { alpha, Button, cardStyle, ProgressBar, textStyle } from '../ui/primitives';
import { Countdown, RewardsListener } from './base';
import { MyindAttribution } from './MyindAttribution';

/** Draws a `picture` question's image, e.g. `(url) => <Image source={{ uri: url }} style={{ height: 180 }} />`. */
export type QuizImageRender = (url: string) => ReactNode;

export interface QuizBodyProps {
  quiz: QuizController;
  texts?: RewardsTexts;
  /** Plays a `listen` question's sound (`media.sound_id`). Without it the play button is hidden. */
  onPlaySound?: (soundId: string) => void;
  /** Draws a `picture` question's image. Without it no picture. */
  renderImage?: QuizImageRender;
  onDone?: () => void;
  /** Shown under the content, inside the scroll (e.g. the attribution link). */
  footer?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** The default quiz look for each phase: rules → question with its time bar → right / wrong → … → score and rewards. */
export function QuizBody(props: QuizBodyProps): ReactNode {
  const kit = useRewardsKit();
  const texts = props.texts ?? kit.texts;
  const t = kit.theme;
  const q = props.quiz;
  const snap = useQuiz(q);
  const x = texts.quiz;
  const body = textStyle(t.bodyStyle, t.onSurface);
  let children: ReactNode;
  switch (snap.phase) {
    case QuizPhase.idle:
    case QuizPhase.loading:
      children = <ActivityIndicator color={t.accent} accessibilityLabel={x.title} />;
      break;
    case QuizPhase.unavailable:
      children = <Text style={body}>{x.unavailable}</Text>;
      break;
    case QuizPhase.error:
      children = (
        <>
          <Text style={textStyle(t.bodyStyle, t.warning)}>{texts.error(snap.reason ?? 'offline')}</Text>
          <Button theme={t} label={x.retry} onPress={() => void q.retry()} style={styles.m12} />
        </>
      );
      break;
    case QuizPhase.intro:
      children = (
        <>
          <Text accessibilityRole="header" style={textStyle(t.titleStyle, t.onSurface)}>
            {x.title}
          </Text>
          <Text style={[body, styles.m8]}>{snap.canStart ? x.rules(snap.quiz?.total ?? 0) : x.comeBack}</Text>
          {snap.canStart ? <Button theme={t} testID="quiz-start" label={x.start} onPress={() => void q.start()} style={styles.m16} /> : null}
        </>
      );
      break;
    case QuizPhase.question:
    case QuizPhase.answering:
    case QuizPhase.reveal: {
      const question = snap.question!;
      const reveal = snap.phase === QuizPhase.reveal;
      const a = snap.lastAnswer;
      const fraction = snap.timeFraction;
      const labels = question.kind === QuizQuestionKind.trueFalse && question.choices.length < 2 ? [x.trueLabel, x.falseLabel] : question.choices;
      const colorOf = (i: number): string | null => {
        if (!reveal || a == null) return null;
        if (i === a.answer) return t.success;
        if (i === snap.picked) return t.warning;
        return null;
      };
      const choice = (i: number): ReactNode => {
        const c = colorOf(i);
        return (
          <Button
            key={i}
            theme={t}
            variant="outlined"
            testID={`quiz-choice-${i}`}
            label={labels[i]!}
            disabled={snap.phase !== QuizPhase.question}
            onPress={() => void q.answer(i)}
            style={[styles.choice, c ? { borderColor: c, borderWidth: 2, backgroundColor: alpha(c, 0.15), opacity: 1 } : null, question.kind === QuizQuestionKind.trueFalse && labels.length === 2 ? styles.flex : null]}
          />
        );
      };
      children = (
        <>
          <Text style={textStyle(t.bodyStyle, t.muted)}>{x.questionOf(question.index + 1, question.total)}</Text>
          <View style={styles.m8}>
            <ProgressBar value={reveal ? 0 : fraction} height={6} color={fraction < 0.25 ? t.warning : t.accent} track={alpha(t.muted, 0.2)} label={x.questionOf(question.index + 1, question.total)} />
          </View>
          {question.kind === QuizQuestionKind.oddOneOut ? <Text style={[textStyle(t.bodyStyle, t.muted), styles.m16]}>{x.oddOneOut}</Text> : null}
          <Text accessibilityRole="header" style={[textStyle(t.titleStyle, t.onSurface), question.kind === QuizQuestionKind.oddOneOut ? null : styles.m16]}>
            {question.prompt}
          </Text>
          {question.kind === QuizQuestionKind.listen && question.soundId != null && props.onPlaySound ? (
            <Button theme={t} variant="outlined" icon="🔊" label={x.playSound} onPress={() => props.onPlaySound!(question.soundId!)} style={styles.m8} />
          ) : null}
          {question.kind === QuizQuestionKind.picture && question.imageUrl != null && props.renderImage ? (
            <View style={styles.m8}>{props.renderImage(question.imageUrl)}</View>
          ) : null}
          {question.kind === QuizQuestionKind.trueFalse && labels.length === 2 ? (
            <View style={[styles.row, styles.m16, styles.gap12]}>
              {choice(0)}
              {choice(1)}
            </View>
          ) : (
            <View style={[styles.m16, styles.gap8]}>{labels.map((_, i) => choice(i))}</View>
          )}
          {reveal && a != null ? (
            <>
              <Text accessibilityLiveRegion="polite" style={[textStyle(t.titleStyle, a.correct ? t.success : t.warning), styles.m8]}>
                {a.timedOut ? x.timeUp : a.correct ? x.right : x.wrong}
              </Text>
              {a.explanation != null ? <Text style={textStyle(t.bodyStyle, t.muted)}>{a.explanation}</Text> : null}
              <Button theme={t} testID="quiz-next" label={x.next} onPress={() => void q.next()} style={styles.m12} />
            </>
          ) : null}
        </>
      );
      break;
    }
    default: {
      const last = snap.quiz?.lastResult ?? null;
      const score = last?.score ?? snap.lastAnswer?.score ?? 0;
      const total = (last?.total ?? 0) > 0 ? last!.total : (snap.quiz?.total ?? 0);
      const grants = snap.finishedGrants;
      children = (
        <>
          <Text accessibilityRole="header" style={[textStyle(t.numberStyle, t.onSurface), styles.center]}>
            {x.score(score, total)}
          </Text>
          {grants.length === 0 ? (
            <Text style={[textStyle(t.bodyStyle, t.muted), styles.center, styles.m12]}>{x.noReward}</Text>
          ) : (
            grants.map((g) => (
              <Text key={g.id} style={[textStyle(t.bodyStyle, t.success), styles.center, styles.m12]}>
                {texts.gotReward(texts.reward(g.spec))}
              </Text>
            ))
          )}
          {snap.canStart ? <Button theme={t} label={x.tryAgain} onPress={() => void q.start()} style={styles.m16} /> : null}
          <Button theme={t} variant="outlined" label={x.done} onPress={props.onDone ?? null} style={styles.m8} />
        </>
      );
    }
  }
  return (
    <ScrollView contentContainerStyle={[{ padding: t.padding }, props.style]}>
      {children}
      {props.footer != null ? <View style={styles.m16}>{props.footer}</View> : null}
    </ScrollView>
  );
}

export interface QuizScreenProps {
  controller: RewardsController;
  program: string;
  /** Your own quiz controller; default one made here (with [controller] for grants and the clock) and disposed. */
  quiz?: QuizController;
  title?: string;
  texts?: RewardsTexts;
  onPlaySound?: (soundId: string) => void;
  renderImage?: QuizImageRender;
  /** Done on the result; with `QuizCard`'s default modal it closes it. */
  onDone?: () => void;
  /** Your own body, re-rendered on every quiz change. */
  render?: (quiz: QuizController) => ReactNode;
  /** A title bar. False when the app's navigator shows its own header. Default true. */
  showAppBar?: boolean;
  /** The small "Rewards by Myind" link under the default body; not added to a [render] body. Default true. */
  showAttribution?: boolean;
  /** Which link text. Default 1, "Rewards by Myind". */
  attributionVariant?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * The whole quiz flow on one screen: rules → question with its countdown bar → right / wrong → … → score and rewards.
 * Resumes an attempt in progress. Sounds and pictures come from the app ([onPlaySound], [renderImage]).
 */
export function QuizScreen(props: QuizScreenProps): ReactNode {
  const kit = useRewardsKit();
  const texts = props.texts ?? kit.texts;
  const t = kit.theme;
  // A controller made here is made in an effect and disposed in its cleanup, so React's development double-mount gets a
  // fresh one instead of a disposed one.
  const [owned, setOwned] = useState<QuizController | null>(null);
  useEffect(() => {
    if (props.quiz) return undefined;
    const made = new QuizController({ client: props.controller.client, program: props.program, rewards: props.controller });
    setOwned(made);
    return () => made.dispose();
  }, [props.quiz, props.controller, props.program]);
  const quiz = props.quiz ?? owned;
  const content = quiz == null ? (
    <ActivityIndicator color={t.accent} style={styles.m16} />
  ) : props.render ? (
    <QuizOpener quiz={quiz}>{props.render(quiz)}</QuizOpener>
  ) : (
    <QuizOpener quiz={quiz}>
    <QuizBody
      quiz={quiz}
      texts={texts}
      {...(props.onPlaySound ? { onPlaySound: props.onPlaySound } : {})}
      {...(props.renderImage ? { renderImage: props.renderImage } : {})}
      {...(props.onDone ? { onDone: props.onDone } : {})}
      footer={(props.showAttribution ?? true) ? <MyindAttribution variant={props.attributionVariant ?? 1} /> : null}
    />
    </QuizOpener>
  );
  return (
    <View testID="quiz-screen" style={[styles.flex, { backgroundColor: t.surface }, props.style]}>
      {(props.showAppBar ?? true) ? (
        <View style={styles.appBar}>
          <Text accessibilityRole="header" style={[textStyle(t.titleStyle, t.onSurface), styles.appBarText]}>
            {props.title ?? texts.quiz.title}
          </Text>
        </View>
      ) : null}
      {content}
    </View>
  );
}

/** Re-renders with the quiz and opens it once after mount while it is idle (resuming an attempt in progress). */
function QuizOpener(props: { quiz: QuizController; children: ReactNode }): ReactNode {
  const q = props.quiz;
  useQuiz(q);
  useEffect(() => {
    if (q.phase !== QuizPhase.idle) return undefined;
    const id = setTimeout(() => {
      if (q.phase === QuizPhase.idle) void q.open();
    }, 0);
    return () => clearTimeout(id);
  }, [q]);
  return <>{props.children}</>;
}

export interface QuizCardProps {
  controller: RewardsController;
  program: string;
  /** Default `texts.quiz.title`. */
  title?: string;
  texts?: RewardsTexts;
  /** Opens the quiz the app's way (its own route); default a full-screen `QuizScreen` in a modal. */
  onOpen?: (program: string) => void;
  onPlaySound?: (soundId: string) => void;
  renderImage?: QuizImageRender;
  /** Your own look. `open` runs [onOpen] or shows the default screen. */
  render?: (quiz: QuizState, open: () => void) => ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** The way into today's quiz: its state, the real time left today, and Start / Resume / See result. */
export function QuizCard(props: QuizCardProps): ReactNode {
  const kit = useRewardsKit();
  const texts = props.texts ?? kit.texts;
  const c = props.controller;
  const [shown, setShown] = useState(false);
  const open = (): void => {
    if (props.onOpen) props.onOpen(props.program);
    else setShown(true);
  };
  return (
    <>
      <RewardsListener
        controller={c}
        render={() => {
          const q = c.state.quiz(props.program);
          if (q == null) return null;
          if (props.render) return props.render(q, open);
          const t = kit.theme;
          const x = texts.quiz;
          const last = q.lastResult;
          let line: string;
          let action: string | null;
          if (q.status === QuizStatus.inProgress) {
            line = x.questionOf(q.current + 1, q.total);
            action = x.resume;
          } else if (q.status === QuizStatus.finished && last != null) {
            line = x.score(last.score, last.total === 0 ? q.total : last.total);
            action = q.canStart ? x.tryAgain : x.seeResult;
          } else if (q.canStart) {
            line = x.rules(q.total);
            action = x.start;
          } else {
            line = x.comeBack;
            action = null;
          }
          return (
            <View testID="quiz-card" style={[cardStyle(t), props.style]}>
              <View style={styles.row}>
                <Text accessibilityElementsHidden importantForAccessibility="no" style={[styles.icon, { color: t.accent }]}>
                  ?
                </Text>
                <Text accessibilityRole="header" style={[textStyle(t.titleStyle, t.onSurface), styles.flex]}>
                  {props.title ?? x.title}
                </Text>
              </View>
              <Text style={[textStyle(t.bodyStyle, t.onSurface), styles.m8]}>{line}</Text>
              <View style={styles.m4}>
                <Countdown endsAt={q.endsAt} clock={c.clock} prefix={x.closesIn} hidden={c.state.choices.timersOff} style={textStyle(t.bodyStyle, t.muted)} onExpired={() => void c.refresh()} />
              </View>
              {action != null ? <Button theme={t} testID="quiz-open" label={action} onPress={open} style={[styles.m12, styles.selfStart]} /> : null}
            </View>
          );
        }}
      />
      {props.onOpen == null && shown ? (
        <Modal visible animationType="slide" onRequestClose={() => setShown(false)}>
          <QuizScreen
            controller={c}
            program={props.program}
            texts={texts}
            {...(props.title ? { title: props.title } : {})}
            {...(props.onPlaySound ? { onPlaySound: props.onPlaySound } : {})}
            {...(props.renderImage ? { renderImage: props.renderImage } : {})}
            onDone={() => setShown(false)}
          />
        </Modal>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  center: { textAlign: 'center' },
  selfStart: { alignSelf: 'flex-start' },
  m4: { marginTop: 4 },
  m8: { marginTop: 8 },
  m12: { marginTop: 12 },
  m16: { marginTop: 16 },
  gap8: { gap: 8 },
  gap12: { gap: 12 },
  choice: { paddingVertical: 14, borderRadius: 12 },
  icon: { fontSize: 20, fontWeight: '700', marginRight: 8 },
  appBar: { paddingHorizontal: 16, paddingVertical: 14 },
  appBarText: { fontSize: 20, lineHeight: 28 },
});
