'use client';
import {
  QuizPhase,
  QuizQuestionKind,
  QuizStatus,
  type QuizController,
  type QuizSnapshot,
  type QuizState,
  type RewardsController,
  type RewardsTexts,
} from '@myind/rewards-core';
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { RewardsListener } from './base';
import { useQuiz, useRewardsController, useRewardsTexts } from './context';
import { Countdown } from './countdown';
import { Icon } from './icons';
import { Card, cx, ProgressBar, type BaseProps } from './internal';
import { AttributionShownContext, ScreenAttribution } from './myind-attribution';

/** What a quiz screen needs from the app for `listen` and `picture` questions. */
export interface QuizMediaProps {
  /** Plays a `listen` question's sound (`media.sound_id`). Without it the play button is hidden. */
  readonly onPlaySound?: (soundId: string) => void;
  /** Draws a `picture` question's image (`media.image_url`), e.g. `(url) => <img src={url} alt="" />`. */
  readonly renderImage?: (url: string) => ReactNode;
}

// ---- QuizBody ----

export interface QuizBodyProps extends QuizMediaProps {
  readonly quiz: QuizController;
  readonly snapshot: QuizSnapshot;
  readonly texts?: RewardsTexts;
  /** "Done" on the result. Hidden without it. */
  readonly onDone?: () => void;
  /** Shown under the content (e.g. `QuizScreen`'s attribution link). */
  readonly footer?: ReactNode;
}

/** The default quiz look for each phase. Used by `QuizScreen`; usable inside your own layout. */
export function QuizBody(props: QuizBodyProps): ReactNode {
  const texts = useRewardsTexts(props.texts);
  const x = texts.quiz;
  const { quiz, snapshot: s } = props;
  let content: ReactNode;
  switch (s.phase) {
    case QuizPhase.idle:
    case QuizPhase.loading:
      content = <span className="rk-spinner rk-spinner--center" role="progressbar" aria-label={x.title} />;
      break;
    case QuizPhase.unavailable:
      content = <p>{x.unavailable}</p>;
      break;
    case QuizPhase.error:
      content = (
        <>
          <p className="rk-warning" role="alert">
            {texts.error(s.reason ?? 'offline')}
          </p>
          <button type="button" className="rk-button" onClick={() => void quiz.retry()}>
            {x.retry}
          </button>
        </>
      );
      break;
    case QuizPhase.intro:
      content = (
        <>
          <h3 className="rk-title">{x.title}</h3>
          <p>{s.canStart ? x.rules(s.quiz?.total ?? 0) : x.comeBack}</p>
          {s.canStart ? (
            <button type="button" className="rk-button" onClick={() => void quiz.start()}>
              {x.start}
            </button>
          ) : null}
        </>
      );
      break;
    case QuizPhase.finished: {
      const last = s.quiz?.lastResult;
      const score = last?.score ?? s.lastAnswer?.score ?? 0;
      const total = (last?.total ?? 0) > 0 ? last!.total : (s.quiz?.total ?? 0);
      content = (
        <div className="rk-quiz__result" role="status">
          <p className="rk-number rk-center">{x.score(score, total)}</p>
          {s.finishedGrants.length === 0 ? (
            <p className="rk-muted rk-center">{x.noReward}</p>
          ) : (
            s.finishedGrants.map((g, i) => (
              <p key={i} className="rk-success rk-center">
                {texts.gotReward(texts.reward(g.spec))}
              </p>
            ))
          )}
          {s.canStart ? (
            <button type="button" className="rk-button" onClick={() => void quiz.start()}>
              {x.tryAgain}
            </button>
          ) : null}
          {props.onDone ? (
            <button type="button" className="rk-button rk-button--outlined" onClick={props.onDone}>
              {x.done}
            </button>
          ) : null}
        </div>
      );
      break;
    }
    default:
      content = <QuizQuestionView quiz={quiz} snapshot={s} texts={texts} {...(props.onPlaySound ? { onPlaySound: props.onPlaySound } : {})} {...(props.renderImage ? { renderImage: props.renderImage } : {})} />;
  }
  return (
    <div className="rk rk-quiz">
      {content}
      {props.footer}
    </div>
  );
}

/** One question with its countdown bar, its choices, and right / wrong once answered. */
export function QuizQuestionView(props: { quiz: QuizController; snapshot: QuizSnapshot; texts: RewardsTexts } & QuizMediaProps): ReactNode {
  const { quiz, snapshot: s, texts } = props;
  const q = s.question;
  const prompt = useRef<HTMLHeadingElement>(null);
  const qid = q?.id;
  useEffect(() => {
    prompt.current?.focus();
  }, [qid]);
  if (q == null) return null;
  const x = texts.quiz;
  const reveal = s.phase === QuizPhase.reveal;
  const a = s.lastAnswer;
  const fraction = s.timeFraction;
  const labels = q.kind === QuizQuestionKind.trueFalse && q.choices.length < 2 ? [x.trueLabel, x.falseLabel] : q.choices;
  const markOf = (i: number): 'right' | 'wrong' | null => {
    if (!reveal || a == null) return null;
    if (i === a.answer) return 'right';
    if (i === s.picked) return 'wrong';
    return null;
  };
  const choice = (i: number): ReactNode => {
    const mark = markOf(i);
    return (
      <button
        key={i}
        type="button"
        data-testid={`quiz-choice-${i}`}
        className={cx('rk-choice', mark && `rk-choice--${mark}`)}
        disabled={s.phase !== QuizPhase.question}
        aria-pressed={s.picked === i}
        onClick={() => void quiz.answer(i)}
      >
        <span className="rk-grow">{labels[i]}</span>
        {mark === 'right' ? <Icon name="check" size={18} title={x.right} /> : mark === 'wrong' ? <Icon name="cross" size={18} title={x.wrong} /> : null}
      </button>
    );
  };
  return (
    <div className="rk-quiz__question">
      <p className="rk-muted">{x.questionOf(q.index + 1, q.total)}</p>
      <ProgressBar value={reveal ? 0 : fraction} tone={fraction < 0.25 ? 'warning' : 'accent'} label={x.questionOf(q.index + 1, q.total)} />
      {q.kind === QuizQuestionKind.oddOneOut ? <p className="rk-muted">{x.oddOneOut}</p> : null}
      <h3 className="rk-title" ref={prompt} tabIndex={-1}>
        {q.prompt}
      </h3>
      {q.kind === QuizQuestionKind.listen && q.soundId != null && props.onPlaySound ? (
        <button type="button" className="rk-button rk-button--outlined" onClick={() => props.onPlaySound!(q.soundId!)}>
          <Icon name="volume" size={18} /> {x.playSound}
        </button>
      ) : null}
      {q.kind === QuizQuestionKind.picture && q.imageUrl != null && props.renderImage ? <div className="rk-quiz__picture">{props.renderImage(q.imageUrl)}</div> : null}
      <div className={cx('rk-choices', q.kind === QuizQuestionKind.trueFalse && labels.length === 2 && 'rk-choices--two')}>{labels.map((_, i) => choice(i))}</div>
      {reveal && a != null ? (
        <div role="status">
          <p className={cx('rk-title', a.correct ? 'rk-success' : 'rk-warning')}>{a.timedOut ? x.timeUp : a.correct ? x.right : x.wrong}</p>
          {a.explanation != null ? <p className="rk-muted">{a.explanation}</p> : null}
          <button type="button" className="rk-button" onClick={() => void quiz.next()}>
            {x.next}
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ---- QuizScreen ----

export interface QuizScreenProps extends QuizMediaProps {
  readonly controller?: RewardsController;
  readonly program: string;
  /** Your own quiz controller; default one made on mount (and disposed on unmount) with the rewards controller. */
  readonly quiz?: QuizController;
  readonly title?: string | null;
  readonly texts?: RewardsTexts;
  /** "Done" on the result. Hidden without it. */
  readonly onDone?: () => void;
  /** Your own look for the whole body, re-rendered on every quiz change (no attribution is added to it). */
  readonly render?: (quiz: QuizController, snapshot: QuizSnapshot) => ReactNode;
  /** The small "Rewards by Myind" link at the bottom of the default body. Default true; false hides it. */
  readonly showAttribution?: boolean;
  /** Which link text; default 1, "Rewards by Myind". */
  readonly attributionVariant?: number;
  /** The heading level of the title. Default 2. */
  readonly headingLevel?: 1 | 2 | 3;
  readonly className?: string;
  readonly style?: CSSProperties;
}

/**
 * The whole quiz flow on one screen: rules → question with its countdown bar → right / wrong → … → score and rewards.
 * Resumes an attempt in progress. Sounds and pictures come from the app ([onPlaySound], [renderImage]).
 */
export function QuizScreen(props: QuizScreenProps): ReactNode {
  const texts = useRewardsTexts(props.texts);
  const c = useRewardsController(props.controller);
  const { quiz, snapshot } = useQuiz(props.program, { controller: c, quiz: props.quiz ?? null });
  const titleId = useId();
  const H = `h${props.headingLevel ?? 2}` as 'h2';
  const title = props.title ?? texts.quiz.title;
  const showAttribution = props.showAttribution ?? true;
  return (
    <section className={cx('rk', 'rk-screen', 'rk-quiz-screen', props.className)} style={props.style} aria-labelledby={titleId}>
      <H id={titleId} className="rk-screen__title">
        {title}
      </H>
      <AttributionShownContext.Provider value={true}>
        {quiz == null || snapshot == null ? (
          <div className="rk rk-quiz">
            <span className="rk-spinner rk-spinner--center" role="progressbar" aria-label={texts.quiz.title} />
          </div>
        ) : props.render ? (
          props.render(quiz, snapshot)
        ) : (
          <QuizBody quiz={quiz} snapshot={snapshot} texts={texts} {...(props.onDone ? { onDone: props.onDone } : {})} {...media(props)} />
        )}
      </AttributionShownContext.Provider>
      {props.render ? null : <ScreenAttribution show={showAttribution} variant={props.attributionVariant ?? 1} />}
    </section>
  );
}

const media = (p: QuizMediaProps): QuizMediaProps => ({
  ...(p.onPlaySound ? { onPlaySound: p.onPlaySound } : {}),
  ...(p.renderImage ? { renderImage: p.renderImage } : {}),
});

// ---- QuizCard ----

export interface QuizCardProps extends BaseProps, QuizMediaProps {
  readonly program: string;
  /** Default `texts.quiz.title`. */
  readonly title?: string | null;
  /** Opens the quiz the app's way (a route); default a `QuizScreen` in a dialog. */
  readonly onOpen?: (program: string) => void;
  /** Your own look. `open` runs [onOpen] or opens the default dialog. */
  readonly render?: (quiz: QuizState, open: () => void) => ReactNode;
}

/** The way into today's quiz: its state, the real time left today, and Start / Resume / See result / Try again. */
export function QuizCard(props: QuizCardProps): ReactNode {
  const texts = useRewardsTexts(props.texts);
  const c = useRewardsController(props.controller);
  const [dialog, setDialog] = useState(false);
  const open = (): void => {
    if (props.onOpen) props.onOpen(props.program);
    else setDialog(true);
  };
  return (
    <>
      <RewardsListener
        controller={c}
        render={({ state }) => {
          const q = state.quiz(props.program);
          if (q == null) return null;
          if (props.render) return props.render(q, open);
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
          const title = props.title ?? x.title;
          return (
            <Card name="rk-quiz-card" className={props.className} style={props.style} label={title}>
              <div className="rk-row">
                <Icon name="quiz" className="rk-accent" />
                <h3 className="rk-title rk-grow">{title}</h3>
              </div>
              <p>{line}</p>
              <Countdown
                endsAt={q.endsAt}
                clock={c.clock}
                prefix={x.closesIn}
                hidden={state.choices.timersOff}
                className="rk-muted rk-block"
                onExpired={() => void c.refresh()}
              />
              {action != null ? (
                <button type="button" className="rk-button" onClick={open}>
                  {action}
                </button>
              ) : null}
            </Card>
          );
        }}
      />
      {dialog ? (
        <QuizDialog onClose={() => setDialog(false)} label={props.title ?? texts.quiz.title} closeLabel={texts.reveal.close}>
          <QuizScreen controller={c} program={props.program} title={props.title ?? null} texts={texts} onDone={() => setDialog(false)} {...media(props)} />
        </QuizDialog>
      ) : null}
    </>
  );
}

/** A modal dialog for the default quiz screen: focus moves in, Escape and the close button close it. */
function QuizDialog(props: { readonly onClose: () => void; readonly label: string; readonly closeLabel: string; readonly children: ReactNode }): ReactNode {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    box.current?.focus();
    return () => prev?.focus?.();
  }, []);
  return (
    <div className="rk rk-dialog-backdrop" onClick={props.onClose}>
      <div
        ref={box}
        tabIndex={-1}
        className="rk-dialog rk-dialog--wide"
        role="dialog"
        aria-modal="true"
        aria-label={props.label}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') props.onClose();
        }}
      >
        <button type="button" className="rk-button rk-button--text rk-dialog__close" aria-label={props.closeLabel} onClick={props.onClose}>
          <Icon name="close" size={18} />
        </button>
        {props.children}
      </div>
    </div>
  );
}
