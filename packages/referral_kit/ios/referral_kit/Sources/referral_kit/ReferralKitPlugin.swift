import Flutter
import UIKit
import UniformTypeIdentifiers

/// iOS side of referral_kit: the native Paste control (ADR 4.2). `UIPasteControl` (iOS 16+) is drawn by the
/// system, so reading the clipboard after the user taps it shows no "Allow Paste" prompt. The package never reads
/// the clipboard on iOS any other way.
public class ReferralKitPlugin: NSObject, FlutterPlugin {
  public static func register(with registrar: FlutterPluginRegistrar) {
    let channel = FlutterMethodChannel(name: "referral_kit/paste", binaryMessenger: registrar.messenger())
    registrar.addMethodCallDelegate(ReferralKitPlugin(), channel: channel)
    registrar.register(
      PasteControlFactory(messenger: registrar.messenger()), withId: "referral_kit/paste_control")
  }

  public func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
    switch call.method {
    case "isPasteControlAvailable":
      if #available(iOS 16.0, *) { result(true) } else { result(false) }
    default:
      result(FlutterMethodNotImplemented)
    }
  }
}

final class PasteControlFactory: NSObject, FlutterPlatformViewFactory {
  private let messenger: FlutterBinaryMessenger

  init(messenger: FlutterBinaryMessenger) {
    self.messenger = messenger
    super.init()
  }

  func create(withFrame frame: CGRect, viewIdentifier viewId: Int64, arguments args: Any?) -> FlutterPlatformView {
    let channel = FlutterMethodChannel(
      name: "referral_kit/paste_control/\(viewId)", binaryMessenger: messenger)
    if #available(iOS 16.0, *) {
      return PasteControlView(frame: frame, channel: channel)
    }
    return EmptyPlatformView(frame: frame)
  }

  func createArgsCodec() -> FlutterMessageCodec & NSObjectProtocol {
    FlutterStandardMessageCodec.sharedInstance()
  }
}

final class EmptyPlatformView: NSObject, FlutterPlatformView {
  private let container: UIView
  init(frame: CGRect) { container = UIView(frame: frame) }
  func view() -> UIView { container }
}

/// Receives the pasted text and forwards it to Dart as `pasted(String)`.
@available(iOS 16.0, *)
final class PasteTarget: UIView {
  var onText: ((String) -> Void)?

  override init(frame: CGRect) {
    super.init(frame: frame)
    pasteConfiguration = UIPasteConfiguration(acceptableTypeIdentifiers: [UTType.plainText.identifier])
  }

  required init?(coder: NSCoder) { nil }

  override func canPaste(_ itemProviders: [NSItemProvider]) -> Bool { true }

  override func paste(itemProviders: [NSItemProvider]) {
    for provider in itemProviders where provider.canLoadObject(ofClass: NSString.self) {
      _ = provider.loadObject(ofClass: NSString.self) { [weak self] value, _ in
        guard let text = value as? String else { return }
        DispatchQueue.main.async { self?.onText?(text) }
      }
      return
    }
  }
}

@available(iOS 16.0, *)
final class PasteControlView: NSObject, FlutterPlatformView {
  private let target: PasteTarget
  private let channel: FlutterMethodChannel

  init(frame: CGRect, channel: FlutterMethodChannel) {
    self.channel = channel
    target = PasteTarget(frame: frame)
    super.init()
    let config = UIPasteControl.Configuration()
    config.displayMode = .iconAndLabel
    config.cornerStyle = .capsule
    let control = UIPasteControl(configuration: config)
    control.target = target
    control.translatesAutoresizingMaskIntoConstraints = false
    target.addSubview(control)
    NSLayoutConstraint.activate([
      control.leadingAnchor.constraint(equalTo: target.leadingAnchor),
      control.trailingAnchor.constraint(equalTo: target.trailingAnchor),
      control.topAnchor.constraint(equalTo: target.topAnchor),
      control.bottomAnchor.constraint(equalTo: target.bottomAnchor),
    ])
    target.onText = { [weak self] text in self?.channel.invokeMethod("pasted", arguments: text) }
  }

  func view() -> UIView { target }
}
