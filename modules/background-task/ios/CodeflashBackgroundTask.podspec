Pod::Spec.new do |s|
  s.name           = 'CodeflashBackgroundTask'
  s.version        = '1.0.0'
  s.summary        = 'iOS background task assertion for iCloud sync'
  s.description    = 'Requests UIApplication background time so large iCloud sync uploads can finish staging when the app backgrounds.'
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
