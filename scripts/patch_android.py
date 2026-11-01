#!/usr/bin/env python3
"""Run after `npx cap add android`. Adds the native plugin, icons, permissions and a fixed signing key.
Every step fails loudly if the generated project does not look the way we expect."""
import os
import re
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, 'android', 'app')
MAIN = os.path.join(APP, 'src', 'main')
PKG_DIR = os.path.join(MAIN, 'java', 'com', 'augrixs', 'augrant')


def fail(msg):
    print('PATCH FAILED: ' + msg, file=sys.stderr)
    sys.exit(1)


def read(p):
    with open(p, encoding='utf-8') as f:
        return f.read()


def write(p, s):
    with open(p, 'w', encoding='utf-8') as f:
        f.write(s)


if not os.path.isdir(APP):
    fail('android/app not found. Run `npx cap add android` first.')

# 1) native plugin and activity
os.makedirs(PKG_DIR, exist_ok=True)
for name in ('SafPlugin.java', 'MainActivity.java', 'PickerChromeClient.java'):
    shutil.copy(os.path.join(ROOT, 'native', name), os.path.join(PKG_DIR, name))

# 2) icons: remove the adaptive icon definitions so our PNG icons are the ones used
res = os.path.join(MAIN, 'res')
for d in os.listdir(res):
    if d.startswith('mipmap-anydpi'):
        shutil.rmtree(os.path.join(res, d))
for fn in ('ic_launcher_foreground.xml', 'ic_launcher_background.xml'):
    for sub in ('drawable', 'drawable-v24', 'values'):
        p = os.path.join(res, sub, fn)
        if os.path.exists(p):
            os.remove(p)
src_res = os.path.join(ROOT, 'native', 'res')
for d in os.listdir(src_res):
    dest = os.path.join(res, d)
    os.makedirs(dest, exist_ok=True)
    for fn in os.listdir(os.path.join(src_res, d)):
        shutil.copy(os.path.join(src_res, d, fn), os.path.join(dest, fn))

# 3) manifest permissions
mf_path = os.path.join(MAIN, 'AndroidManifest.xml')
mf = read(mf_path)
if 'READ_MEDIA_VIDEO' not in mf:
    perms = (
        '    <uses-permission android:name="android.permission.READ_MEDIA_VIDEO" />\n'
        '    <uses-permission android:name="android.permission.READ_MEDIA_AUDIO" />\n'
        '    <uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />\n'
        '    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />\n'
        '    <uses-permission android:name="android.permission.WAKE_LOCK" />\n'
    )
    if '</manifest>' not in mf:
        fail('AndroidManifest.xml has no </manifest>')
    mf = mf.replace('</manifest>', perms + '</manifest>', 1)
    write(mf_path, mf)

# 4) gradle: fixed debug key (so new builds can update an installed app) and a rising versionCode
gr_path = os.path.join(APP, 'build.gradle')
gr = read(gr_path)
if 'augrant-signing' not in gr:
    block = (
        "android {\n"
        "    // augrant-signing\n"
        "    signingConfigs {\n"
        "        debug {\n"
        "            storeFile file('../../native/debug.keystore')\n"
        "            storePassword 'android'\n"
        "            keyAlias 'androiddebugkey'\n"
        "            keyPassword 'android'\n"
        "        }\n"
        "    }\n"
    )
    gr, n = re.subn(r'^android\s*\{\s*\n', block, gr, count=1, flags=re.M)
    if n != 1:
        fail('could not find the android { block in app/build.gradle')
run = os.environ.get('RUN_NUMBER', '1')
if not run.isdigit():
    run = '1'
gr, n = re.subn(r'versionCode\s+\d+', 'versionCode ' + run, gr, count=1)
if n != 1:
    fail('could not find versionCode in app/build.gradle')
write(gr_path, gr)

print('Android project patched. versionCode =', run)
