import 'fakes.dart';

/// One `rewards_followups_plan` item, [at] hours from [serverNow].
Map<String, Object?> planItem(int id, double hours, {String program = 'inactive2'}) => {
  'id': id,
  'program': program,
  'at': iso(serverNow.add(Duration(minutes: (hours * 60).round()))),
  'title': 'App',
  'body': 'Your next step is still here.',
  'payload': '/app/home',
  'group': 'daily',
};

Map<String, Object?> planJson(List<Map<String, Object?>> items, {DateTime? serverTime}) => {
  'server_time': iso(serverTime ?? serverNow),
  'plan': items,
};
