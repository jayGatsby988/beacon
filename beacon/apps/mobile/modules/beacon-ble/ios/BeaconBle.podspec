Pod::Spec.new do |s|
  s.name = 'BeaconBle'
  s.version = '1.0.0'
  s.summary = 'Beacon foreground BLE transport'
  s.description = 'CoreBluetooth central and peripheral transport for Beacon.'
  s.author = 'Beacon'
  s.homepage = 'https://docs.expo.dev/modules/'
  s.license = { :type => 'MIT' }
  s.platform = :ios, '15.1'
  s.source = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'CoreBluetooth', 'AVFoundation', 'CryptoKit'
  s.source_files = '*.{h,m,mm,swift}', 'vendor/opus/**/*.{c,h}'
  s.public_header_files = 'BeaconOpusCodec.h'
  s.private_header_files = 'vendor/opus/**/*.h'
  s.pod_target_xcconfig = {
    'GCC_PREPROCESSOR_DEFINITIONS' => '$(inherited) HAVE_CONFIG_H=1',
    'HEADER_SEARCH_PATHS' => '$(inherited) "$(PODS_TARGET_SRCROOT)/vendor/opus" "$(PODS_TARGET_SRCROOT)/vendor/opus/include" "$(PODS_TARGET_SRCROOT)/vendor/opus/src" "$(PODS_TARGET_SRCROOT)/vendor/opus/celt" "$(PODS_TARGET_SRCROOT)/vendor/opus/silk" "$(PODS_TARGET_SRCROOT)/vendor/opus/silk/float"'
  }
  s.swift_version = '5.9'
end
