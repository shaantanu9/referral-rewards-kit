// material_ui needs Flutter 3.47+; kept until the minimum Flutter is raised.
// ignore: deprecated_member_use
import 'package:flutter/material.dart';

/// Colours, shape and text styles of the default widgets. Add it to your `ThemeData.extensions` to match the app;
/// without it every value comes from the app's own `ColorScheme` and `TextTheme`, so the widgets look native.
/// For a different layout altogether, use each widget's `builder`.
@immutable
class RewardsTheme extends ThemeExtension<RewardsTheme> {
  const RewardsTheme({
    this.accent,
    this.onAccent,
    this.surface,
    this.onSurface,
    this.muted,
    this.success,
    this.warning,
    this.radius,
    this.padding,
    this.titleStyle,
    this.bodyStyle,
    this.numberStyle,
  });

  final Color? accent;
  final Color? onAccent;
  final Color? surface;
  final Color? onSurface;
  final Color? muted;
  final Color? success;

  /// "Ends soon" / "at risk" colour.
  final Color? warning;
  final double? radius;
  final EdgeInsetsGeometry? padding;
  final TextStyle? titleStyle;
  final TextStyle? bodyStyle;

  /// Big numbers (streak days, countdowns).
  final TextStyle? numberStyle;

  /// The app's [RewardsTheme] with every missing value filled from its `ThemeData`.
  static RewardsTheme of(BuildContext context) {
    final t = Theme.of(context);
    final c = t.colorScheme;
    final x = t.extension<RewardsTheme>() ?? const RewardsTheme();
    return RewardsTheme(
      accent: x.accent ?? c.primary,
      onAccent: x.onAccent ?? c.onPrimary,
      surface: x.surface ?? c.surfaceContainerHighest,
      onSurface: x.onSurface ?? c.onSurface,
      muted: x.muted ?? c.onSurfaceVariant,
      success: x.success ?? Colors.green.shade700,
      warning: x.warning ?? c.error,
      radius: x.radius ?? 16,
      padding: x.padding ?? const EdgeInsets.all(16),
      titleStyle: x.titleStyle ?? t.textTheme.titleMedium,
      bodyStyle: x.bodyStyle ?? t.textTheme.bodyMedium,
      numberStyle: x.numberStyle ?? t.textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w700),
    );
  }

  /// The card every default widget sits in.
  BoxDecoration get card => BoxDecoration(color: surface, borderRadius: BorderRadius.circular(radius ?? 16));

  @override
  RewardsTheme copyWith({
    Color? accent,
    Color? onAccent,
    Color? surface,
    Color? onSurface,
    Color? muted,
    Color? success,
    Color? warning,
    double? radius,
    EdgeInsetsGeometry? padding,
    TextStyle? titleStyle,
    TextStyle? bodyStyle,
    TextStyle? numberStyle,
  }) => RewardsTheme(
    accent: accent ?? this.accent,
    onAccent: onAccent ?? this.onAccent,
    surface: surface ?? this.surface,
    onSurface: onSurface ?? this.onSurface,
    muted: muted ?? this.muted,
    success: success ?? this.success,
    warning: warning ?? this.warning,
    radius: radius ?? this.radius,
    padding: padding ?? this.padding,
    titleStyle: titleStyle ?? this.titleStyle,
    bodyStyle: bodyStyle ?? this.bodyStyle,
    numberStyle: numberStyle ?? this.numberStyle,
  );

  @override
  RewardsTheme lerp(covariant RewardsTheme? other, double t) {
    if (other == null) return this;
    return RewardsTheme(
      accent: Color.lerp(accent, other.accent, t),
      onAccent: Color.lerp(onAccent, other.onAccent, t),
      surface: Color.lerp(surface, other.surface, t),
      onSurface: Color.lerp(onSurface, other.onSurface, t),
      muted: Color.lerp(muted, other.muted, t),
      success: Color.lerp(success, other.success, t),
      warning: Color.lerp(warning, other.warning, t),
      radius: t < 0.5 ? radius : other.radius,
      padding: EdgeInsetsGeometry.lerp(padding, other.padding, t),
      titleStyle: TextStyle.lerp(titleStyle, other.titleStyle, t),
      bodyStyle: TextStyle.lerp(bodyStyle, other.bodyStyle, t),
      numberStyle: TextStyle.lerp(numberStyle, other.numberStyle, t),
    );
  }
}
