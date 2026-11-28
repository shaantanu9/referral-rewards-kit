// material_ui needs Flutter 3.47+; kept until the minimum Flutter is raised.
// ignore: deprecated_member_use
import 'package:flutter/material.dart';

import '../controller.dart';
import '../models.dart';
import '../texts.dart';
import 'base.dart';
import 'friend_streaks.dart';
import 'league_board.dart';
import 'milestone_progress.dart';
import 'myind_attribution.dart';
import 'offer_banner.dart';
import 'quest_list.dart';
import 'quiz_card.dart';
import 'recharge_meter.dart';
import 'reward_inbox.dart';
import 'social_tag_task.dart';
import 'streak_card.dart';
import 'surprise_odds.dart';
import 'window_badge.dart';

/// Every live program on one screen, in the server's order: inbox first, then each program's default widget.
/// Replace any program's widget with [programBuilders] (`{'daily': (context, p) => MyStreak(...)}`), or hide one by
/// returning `SizedBox.shrink()`. Titles come from the program's `public.title` when the app set one.
///
/// When the state has surprise rules (`state.surprises`), one "Surprises" card ([SurpriseOdds]) with every odds line
/// sits right under the inbox, so the odds are seen before anything is earned. [showSurprises] false hides it
/// (then show the odds somewhere else yourself). It is not shown while the state hides surprises (the user switched
/// them off, 0.7, or `state.hideSurprises`).
///
/// Extension hooks (0.8.1): [leadingSections] sit right under the inbox, [extraSections] under the odds card, before
/// the programs; [kindBuilders] build programs of a kind this version does not know, by their wire kind
/// (`ProgramInfo.kindWire`).
class RewardsHub extends StatelessWidget {
  const RewardsHub({
    super.key,
    required this.controller,
    this.texts = const RewardsTexts(),
    this.programBuilders = const {},
    this.onOpenInstagram,
    this.onShareInvite,
    this.onOpenQuiz,
    this.onPlaySound,
    this.imageBuilder,
    this.scrollable = true,
    this.padding = const EdgeInsets.all(16),
    this.spacing = 12,
    this.header,
    this.showSurprises = true,
    this.showAttribution = true,
    this.attributionVariant = 1,
    this.leadingSections,
    this.extraSections,
    this.kindBuilders = const {},
  });

  /// Widgets right under the inbox (extension hook).
  final List<Widget> Function(BuildContext context)? leadingSections;

  /// Widgets under the odds card, before the programs (extension hook).
  final List<Widget> Function(BuildContext context)? extraSections;

  /// Builds a program of a kind this version does not know, keyed by `ProgramInfo.kindWire` (extension hook).
  final Map<String, Widget Function(BuildContext context, ProgramInfo program)> kindBuilders;

  final RewardsController controller;
  final RewardsTexts texts;
  final Map<String, Widget Function(BuildContext context, ProgramInfo program)> programBuilders;
  final void Function(String account)? onOpenInstagram;

  /// Shares a friend-streak invite code ([FriendStreaks.onShareInvite]).
  final void Function(String code)? onShareInvite;

  /// Opens a quiz the app's way; default pushes `QuizScreen` ([QuizCard.onOpen]).
  final void Function(String program)? onOpenQuiz;

  /// For the default quiz screen: `listen` sounds and `picture` images.
  final void Function(String soundId)? onPlaySound;
  final Widget Function(BuildContext context, String url)? imageBuilder;

  /// False inside a list that already scrolls.
  final bool scrollable;
  final EdgeInsetsGeometry padding;
  final double spacing;
  final Widget? header;

  /// The "Surprises" odds card under the inbox. Default true.
  final bool showSurprises;

  /// The small "Rewards by Myind" link at the bottom ([MyindAttribution]). Free to turn off: false hides it.
  final bool showAttribution;

  /// Which link text ([MyindAttribution.variant]); default 1, "Rewards by Myind".
  final int attributionVariant;

  Widget _program(BuildContext context, ProgramInfo p) {
    final custom = programBuilders[p.key];
    if (custom != null) return custom(context, p);
    final byKind = p.kind == ProgramKind.unknown ? kindBuilders[p.kindWire] : null;
    if (byKind != null) return byKind(context, p);
    final title = p.public['title']?.toString();
    return switch (p.kind) {
      ProgramKind.streak => StreakCard(controller: controller, program: p.key, texts: texts),
      ProgramKind.milestone => MilestoneProgress(controller: controller, program: p.key, title: title, texts: texts),
      ProgramKind.offer => OfferBanner(controller: controller, program: p.key, title: title, texts: texts),
      ProgramKind.socialTag => SocialTagTask(
        controller: controller,
        program: p.key,
        texts: texts,
        onOpenInstagram: onOpenInstagram,
      ),
      ProgramKind.quiz => QuizCard(
        controller: controller,
        program: p.key,
        title: title,
        texts: texts,
        onOpen: onOpenQuiz,
        onPlaySound: onPlaySound,
        imageBuilder: imageBuilder,
      ),
      ProgramKind.questSet => QuestList(controller: controller, program: p.key, title: title, texts: texts),
      ProgramKind.recharge => RechargeMeter(controller: controller, program: p.key, texts: texts),
      ProgramKind.window => Align(
        alignment: AlignmentDirectional.centerStart,
        child: WindowBadge(controller: controller, program: p.key, title: title, texts: texts),
      ),
      ProgramKind.friendStreak => FriendStreaks(
        controller: controller,
        program: p.key,
        title: title,
        texts: texts,
        onShareInvite: onShareInvite,
      ),
      ProgramKind.league => LeagueBoard(controller: controller, program: p.key, title: title, texts: texts),
      // A comeback reward has nothing to show before it is earned; it lands in the inbox.
      ProgramKind.comeback || ProgramKind.unknown => const SizedBox.shrink(),
    };
  }

  @override
  Widget build(BuildContext context) => RewardsListener(
    controller: controller,
    builder: (context) {
      final children = <Widget>[
        ?header,
        RewardInbox(controller: controller, texts: texts),
        ...?leadingSections?.call(context),
        if (showSurprises && controller.state.surprises.isNotEmpty && !controller.state.hideSurprises)
          SurpriseOdds(controller: controller, texts: texts),
        ...?extraSections?.call(context),
        for (final p in controller.state.programs) _program(context, p),
        if (showAttribution) MyindAttribution(variant: attributionVariant),
      ];
      final column = Padding(
        padding: padding,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          spacing: spacing,
          children: children,
        ),
      );
      if (!scrollable) return column;
      return RefreshIndicator(
        onRefresh: controller.refresh,
        child: SingleChildScrollView(physics: const AlwaysScrollableScrollPhysics(), child: column),
      );
    },
  );
}
