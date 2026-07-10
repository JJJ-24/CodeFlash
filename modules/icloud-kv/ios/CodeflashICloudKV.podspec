Pod::Spec.new do |s|
  s.name           = 'CodeflashICloudKV'
  s.version        = '1.0.0'
  s.summary        = 'iCloud Key-Value Store access for Pro trial state'
  s.description    = 'Reads/writes NSUbiquitousKeyValueStore so the one-time Pro trial start time survives reinstall per Apple ID (ticket 035).'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '15.1'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
