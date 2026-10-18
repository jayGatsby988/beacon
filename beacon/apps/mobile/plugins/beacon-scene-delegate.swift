// Beacon single-scene bridge for Expo SDK 54. Keep React and Expo lifecycle handling
// in AppDelegate; UIKit delivers window/link/foreground callbacks here with scenes.
class BeaconSceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  private var appDelegate: AppDelegate? {
    UIApplication.shared.delegate as? AppDelegate
  }

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene,
      let delegate = appDelegate,
      let factory = delegate.reactNativeFactory else { return }

    // A scene can reconnect while the process and React host remain alive.
    if let existingWindow = delegate.window {
      window = existingWindow
      existingWindow.windowScene = windowScene
      existingWindow.makeKeyAndVisible()
      forwardConnectionLinks(connectionOptions)
      return
    }

    var launchOptions = delegate.beaconLaunchOptions ?? [:]
    if let context = connectionOptions.urlContexts.first {
      launchOptions[.url] = context.url
      launchOptions[.sourceApplication] = context.options.sourceApplication
      launchOptions[.annotation] = context.options.annotation
    }
    if let activity = connectionOptions.userActivities.first(where: {
      $0.activityType == NSUserActivityTypeBrowsingWeb
    }) ?? connectionOptions.userActivities.first {
      launchOptions[.userActivityDictionary] = [
        UIApplication.LaunchOptionsKey.userActivityType.rawValue: activity.activityType,
        "UIApplicationLaunchOptionsUserActivityKey": activity
      ]
    }

    // Prime Expo Linking's initial URL before JS starts. React Native also needs
    // launchOptions above for its getInitialURL; live events alone race startup.
    forwardConnectionLinks(connectionOptions)
    let sceneWindow = UIWindow(windowScene: windowScene)
    window = sceneWindow
    delegate.window = sceneWindow
    factory.startReactNative(withModuleName: "main", in: sceneWindow, launchOptions: launchOptions)
    delegate.beaconLaunchOptions = nil
  }

  private func forwardConnectionLinks(_ options: UIScene.ConnectionOptions) {
    for context in options.urlContexts { forwardURL(context) }
    for activity in options.userActivities { forwardActivity(activity) }
  }

  private func forwardURL(_ context: UIOpenURLContext) {
    var options: [UIApplication.OpenURLOptionsKey: Any] = [
      .openInPlace: context.options.openInPlace
    ]
    options[.sourceApplication] = context.options.sourceApplication
    options[.annotation] = context.options.annotation
    _ = appDelegate?.application(UIApplication.shared, open: context.url, options: options)
  }

  private func forwardActivity(_ activity: NSUserActivity) {
    _ = appDelegate?.application(UIApplication.shared, continue: activity, restorationHandler: { _ in })
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    for context in URLContexts { forwardURL(context) }
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    forwardActivity(userActivity)
  }

  func sceneDidBecomeActive(_ scene: UIScene) {
    appDelegate?.applicationDidBecomeActive(UIApplication.shared)
  }

  func sceneWillResignActive(_ scene: UIScene) {
    appDelegate?.applicationWillResignActive(UIApplication.shared)
  }

  func sceneWillEnterForeground(_ scene: UIScene) {
    appDelegate?.applicationWillEnterForeground(UIApplication.shared)
  }

  func sceneDidEnterBackground(_ scene: UIScene) {
    appDelegate?.applicationDidEnterBackground(UIApplication.shared)
  }
}
