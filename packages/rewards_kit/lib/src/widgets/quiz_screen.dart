import 'package:flutter/material.dart';

import '../controller.dart';
import '../quiz_controller.dart';
import '../texts.dart';
import 'quiz_views.dart';

/// The whole quiz flow on one screen: rules → question with its countdown bar → right / wrong → … → score and
/// rewards. Resumes an attempt in progress. Sounds and pictures come from the app ([onPlaySound], [imageBuilder]),
/// so the package adds no plugin.
///
/// Pass [quiz] to drive it yourself, or let the screen make (and dispose) one from [controller].
class QuizScreen extends StatefulWidget {
  const QuizScreen({
    super.key,
    required this.controller,
    required this.program,
    this.quiz,
    this.title,
    this.texts = const RewardsTexts(),
    this.onPlaySound,
    this.imageBuilder,
    this.onDone,
    this.builder,
  });

  final RewardsController controller;
  final String program;

  /// Your own controller; default: one made in `initState` with [controller] for grants and the clock.
  final QuizController? quiz;
  final String? title;
  final RewardsTexts texts;

  /// Plays a `listen` question's sound (`media.sound_id`). Without it the play button is hidden.
  final void Function(String soundId)? onPlaySound;

  /// Draws a `picture` question's image (`media.image_url`), e.g. `Image.network(url)`. Without it no picture.
  final Widget Function(BuildContext context, String url)? imageBuilder;

  /// Done on the result; default pops the route.
  final VoidCallback? onDone;

  /// Your own look for the whole screen body, rebuilt on every quiz change.
  final Widget Function(BuildContext context, QuizController quiz)? builder;

  /// A route to the default screen.
  static Route<void> route({
    required RewardsController controller,
    required String program,
    String? title,
    RewardsTexts texts = const RewardsTexts(),
    void Function(String soundId)? onPlaySound,
    Widget Function(BuildContext context, String url)? imageBuilder,
  }) => MaterialPageRoute<void>(
    builder: (_) => QuizScreen(
      controller: controller,
      program: program,
      title: title,
      texts: texts,
      onPlaySound: onPlaySound,
      imageBuilder: imageBuilder,
    ),
  );

  @override
  State<QuizScreen> createState() => _QuizScreenState();
}

class _QuizScreenState extends State<QuizScreen> {
  late QuizController _quiz;
  bool _owned = false;

  @override
  void initState() {
    super.initState();
    _quiz =
        widget.quiz ??
        QuizController(client: widget.controller.client, program: widget.program, rewards: widget.controller);
    _owned = widget.quiz == null;
    if (_quiz.phase == QuizPhase.idle) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && _quiz.phase == QuizPhase.idle) _quiz.open();
      });
    }
  }

  @override
  void dispose() {
    if (_owned) _quiz.dispose();
    super.dispose();
  }

  void _done() {
    final f = widget.onDone;
    if (f != null) return f();
    Navigator.of(context).maybePop();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(widget.title ?? widget.texts.quiz.title)),
    body: SafeArea(
      child: ListenableBuilder(
        listenable: _quiz,
        builder: (context, _) {
          final b = widget.builder;
          if (b != null) return b(context, _quiz);
          return QuizBody(
            quiz: _quiz,
            texts: widget.texts,
            onPlaySound: widget.onPlaySound,
            imageBuilder: widget.imageBuilder,
            onDone: _done,
          );
        },
      ),
    ),
  );
}
