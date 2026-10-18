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
  s.frameworks = 'CoreBluetooth'
  s.source_files = '**/*.{h,m,mm,swift}'
  s.swift_version = '5.9'
end
