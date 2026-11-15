import 'package:flutter/widgets.dart';

import '../controller.dart';

/// Rebuilds on every controller change and loads the state once when nobody has yet (after the first frame, so a
/// widget never triggers a rebuild during build). Shows [hidden] (default: nothing) while rewards are not visible.
class RewardsListener extends StatefulWidget {
  const RewardsListener({super.key, required this.controller, required this.builder, this.hidden});

  final RewardsController controller;
  final WidgetBuilder builder;
  final WidgetBuilder? hidden;

  @override
  State<RewardsListener> createState() => _RewardsListenerState();
}

class _RewardsListenerState extends State<RewardsListener> {
  @override
  void initState() {
    super.initState();
    if (!widget.controller.loaded && !widget.controller.loading) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && !widget.controller.loaded) widget.controller.refresh();
      });
    }
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: widget.controller,
    builder: (context, _) =>
        widget.controller.visible ? widget.builder(context) : (widget.hidden?.call(context) ?? const SizedBox.shrink()),
  );
}
