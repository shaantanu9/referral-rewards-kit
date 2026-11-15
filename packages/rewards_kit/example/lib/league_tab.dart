// The League tab: an opt-in weekly league, and the year recap as a shareable card. Sharing is the app's own: here
// the PNG bytes are only measured; a real app hands them to share_plus (`XFile.fromData(bytes, mimeType: 'image/png')`).
import 'package:flutter/material.dart';
import 'package:rewards_kit/rewards_kit.dart';

class LeagueTab extends StatefulWidget {
  const LeagueTab({super.key, required this.controller});
  final RewardsController controller;

  @override
  State<LeagueTab> createState() => _LeagueTabState();
}

class _LeagueTabState extends State<LeagueTab> {
  final shareKey = RecapShareKey();
  late final (DateTime, DateTime) year = recapYear(DateTime.now().year);

  @override
  void initState() {
    super.initState();
    widget.controller.loadRecap(year.$1, year.$2);
  }

  Future<void> _share() async {
    final bytes = await shareKey.toPngBytes();
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(bytes == null ? 'The card is not on screen yet' : 'Share image ready: ${bytes.length} bytes'),
      ),
    );
  }

  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.all(16),
    children: [
      LeagueBoard(controller: widget.controller, program: 'weekly', title: 'Reading league', maxRows: 5),
      const SizedBox(height: 16),
      ListenableBuilder(
        listenable: widget.controller,
        builder: (context, _) {
          final recap = widget.controller.recap(year.$1, year.$2);
          if (recap == null) return const SizedBox.shrink();
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              RewardsRecapCard(recap: recap, subtitle: 'rewards_kit demo', shareKey: shareKey),
              const SizedBox(height: 8),
              FilledButton.icon(
                onPressed: _share,
                icon: const Icon(Icons.ios_share),
                label: const Text('Share my year'),
              ),
            ],
          );
        },
      ),
    ],
  );
}
