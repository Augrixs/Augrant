#!/usr/bin/env python3
"""Run after `npx cap add ios`. Adds the usage texts iOS asks for and lets the app's files show in the Files app."""
import os
import plistlib
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLIST = os.path.join(ROOT, 'ios', 'App', 'App', 'Info.plist')
if not os.path.exists(PLIST):
    print('PATCH FAILED: ' + PLIST + ' not found', file=sys.stderr)
    sys.exit(1)

with open(PLIST, 'rb') as f:
    data = plistlib.load(f)
data['NSPhotoLibraryUsageDescription'] = 'Augrant needs your videos and photos so you can use them as backgrounds.'
data['NSCameraUsageDescription'] = 'Augrant can take a photo or video when you choose the camera in a file picker.'
data['NSMicrophoneUsageDescription'] = 'Augrant can record sound when you choose it in a file picker.'
data['UIFileSharingEnabled'] = True
data['LSSupportsOpeningDocumentsInPlace'] = True
with open(PLIST, 'wb') as f:
    plistlib.dump(data, f)
print('Info.plist patched')
