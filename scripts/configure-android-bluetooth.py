from pathlib import Path

manifest = Path("android/app/src/main/AndroidManifest.xml")
if not manifest.exists():
    raise SystemExit("Android manifest was not generated")

content = manifest.read_text(encoding="utf-8")
if "xmlns:tools=" not in content:
    content = content.replace(
        "xmlns:android=\"http://schemas.android.com/apk/res/android\"",
        "xmlns:android=\"http://schemas.android.com/apk/res/android\" xmlns:tools=\"http://schemas.android.com/tools\"",
        1,
    )

permissions = [
    '    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" android:maxSdkVersion="30" tools:replace="android:maxSdkVersion" />',
    '    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" android:maxSdkVersion="30" tools:replace="android:maxSdkVersion" />',
    '    <uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />',
    '    <uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />',
    '    <uses-permission android:name="android.permission.BLUETOOTH_SCAN" android:usesPermissionFlags="neverForLocation" tools:targetApi="s" />',
    '    <uses-permission android:name="android.permission.BLUETOOTH_CONNECT" tools:targetApi="s" />',
]
for permission in permissions:
    name = permission.split('android:name="', 1)[1].split('"', 1)[0]
    if name not in content:
        content = content.replace("<application", permission + "\n    <application", 1)

manifest.write_text(content, encoding="utf-8")
print("Configured Bluetooth LE permissions; scan results are not used for physical location.")
