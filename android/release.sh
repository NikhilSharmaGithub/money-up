#!/usr/bin/env bash
#
# MoneyMove for Google Play: the one command that turns this Mac's source into
# the signed bundle Play Console takes.
#
#   cd ~/"Downloads/Monopoly nikhil/android" && ./release.sh
#
# Run it in your own Terminal, never through anyone else. It is the only thing
# in this project that ever holds the signing password, and it holds it only
# for as long as the build and two keytool calls need it:
#
#   1. The first time, it makes the upload key, ~/moneymove-keys/moneymove-release.jks.
#      keytool asks you for the password and your name itself; this script
#      never sees what you type there.
#   2. It asks for that password once, hidden, and hands it to the Gradle build
#      alone, through the environment variables build.gradle.kts reads. It is
#      never printed, never written to a file, never put on a command line
#      where `ps` could show it, and it is unset before the script ends.
#   3. It builds app-release.aab, copies it to ~/Downloads/moneymove-play, and
#      prints the key's SHA-1 and SHA-256. Those two are public fingerprints,
#      not secrets: paste them to Claude for the Google sign-in client.
#   4. It checks the bundle for the things Play would otherwise catch after
#      the upload: the signature, the AD_ID permission, and the AdMob app id.
#
# Do not run it with `bash -x`: tracing prints every expanded line, and one of
# those lines carries the password.

set -euo pipefail

# ---------------------------------------------------------------- places --

# Everything is found from where this file lives, so it works from any folder.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEY_DIR="$HOME/moneymove-keys"
KEYSTORE="$KEY_DIR/moneymove-release.jks"
ALIAS="moneymove"
OUT_DIR="$HOME/Downloads/moneymove-play"
AAB="$HERE/app/build/outputs/bundle/release/app-release.aab"

say()  { printf '%s\n' "$*"; }
rule() { say "------------------------------------------------------------------------"; }
die()  { printf '\nrelease.sh: %s\n' "$*" >&2; exit 1; }

# The password lives in these two variables and nowhere else. Whatever way the
# script ends, finished, failed or interrupted, they are wiped on the way out.
store_pw=""
key_pw=""
trap 'unset -v store_pw key_pw' EXIT

# A hidden prompt needs a keyboard behind it.
[[ -t 0 ]] || die "run this in Terminal, where it can ask for the password."

# --------------------------------------------------------- before a build --

# Push rides on google-services.json. Without it the Gradle file quietly leaves
# the Firebase plugin off and the build still succeeds, so a release made here
# would reach every player with notifications silently dead. Better to stop.
[[ -f "$HERE/app/google-services.json" ]] \
  || die "android/app/google-services.json is missing. Without it this release would ship with push switched off. Download it from the Firebase console (project settings, the Android app com.moneymove.game) into android/app/ and run this again."

# Java: Android Studio's own runtime if Android Studio is installed, otherwise
# the JDK that came with the editor's Java extension, which is what has built
# this app since Android Studio went missing.
JAVA_HOME=""
for candidate in \
  "/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
  "$HOME/.antigravity/extensions/redhat.java-1.52.0-darwin-arm64/jre/21.0.9-macosx-aarch64"
do
  if [[ -x "$candidate/bin/java" && -x "$candidate/bin/keytool" ]]; then
    JAVA_HOME="$candidate"
    break
  fi
done
[[ -n "$JAVA_HOME" ]] || die "no Java found. Install Android Studio, or point this script at a JDK 17 or newer."
export JAVA_HOME
KEYTOOL="$JAVA_HOME/bin/keytool"
JARSIGNER="$JAVA_HOME/bin/jarsigner"

export ANDROID_HOME="$HOME/Library/Android/sdk"
[[ -d "$ANDROID_HOME" ]] || die "no Android SDK at $ANDROID_HOME."

command -v unzip >/dev/null || die "unzip is missing, and the bundle checks need it."

rule
say "MoneyMove release build"
say "  Java:     $JAVA_HOME"
say "  SDK:      $ANDROID_HOME"
say "  Keystore: $KEYSTORE"
rule

# ------------------------------------------------------ the upload key --

# Made once, and only if it is not already there: running this a second time
# must never replace a key Play already knows, because a new key is a key Play
# refuses. keytool itself asks for the password (twice) and for the name,
# organisation and country fields; this script only starts it.
if [[ ! -f "$KEYSTORE" ]]; then
  say ""
  say "No upload key yet. keytool will now make one and ask you some questions."
  say "Choose a strong password and save it in your password manager first."
  say "Your real name is fine for the name fields; press Return to skip any of them."
  say ""
  mkdir -p "$KEY_DIR"
  chmod 700 "$KEY_DIR"
  "$KEYTOOL" -genkeypair -v \
    -keystore "$KEYSTORE" -storetype PKCS12 \
    -alias "$ALIAS" -keyalg RSA -keysize 2048 -validity 10000
  [[ -f "$KEYSTORE" ]] || die "keytool did not create the keystore."
  chmod 600 "$KEYSTORE"
  say ""
  say "########################################################################"
  say "##                                                                    ##"
  say "##   BACK UP  ~/moneymove-keys  NOW, AND THE PASSWORD WITH IT.        ##"
  say "##                                                                    ##"
  say "##   Every MoneyMove update must be signed with this exact file.      ##"
  say "##   Lose it, or its password, and you cannot ship an update: only    ##"
  say "##   Google can reset it, after a support request and days of         ##"
  say "##   waiting. Treat losing it as never updating the app again.        ##"
  say "##                                                                    ##"
  say "##   Copy the folder to a USB drive or cloud storage you trust, and   ##"
  say "##   keep the password in a password manager. Never put it in git.    ##"
  say "##                                                                    ##"
  say "########################################################################"
  say ""
  read -r -p "Press Return once you have made a backup (or will do so right after this build)... " _
fi

# ----------------------------------------------------------- the password --

# Asked once, hidden. A key made by this script (PKCS12) has one password for
# the file and the key, so the same answer serves both; a different key
# password only exists on an older JKS keystore, and is asked for only if you
# say so.
say ""
read -r -s -p "Keystore password: " store_pw
say ""
[[ -n "$store_pw" ]] || die "no password given."

read -r -p "Is the key password the same? [Y/n] " same
case "$same" in
  [nN]*)
    read -r -s -p "Key password: " key_pw
    say ""
    [[ -n "$key_pw" ]] || die "no key password given."
    ;;
  *)
    key_pw="$store_pw"
    ;;
esac

# Check the password against the keystore before spending minutes on a build.
# keytool reads it from an environment variable set for this one call
# (-storepass:env), so it never appears in the process list; what is shown on
# failure is keytool's own error line, which never contains the password.
if ! check="$(MM_KEYSTORE_PASSWORD="$store_pw" "$KEYTOOL" -list \
      -keystore "$KEYSTORE" -alias "$ALIAS" -storepass:env MM_KEYSTORE_PASSWORD 2>&1)"; then
  die "that password does not open $KEYSTORE, or the key \"$ALIAS\" is not in it. keytool said: $(printf '%s' "$check" | tail -n 1)"
fi

# --------------------------------------------------------------- the build --

# Any bundle left from an earlier run goes first, so the one copied below can
# only be the one this build made.
rm -f "$AAB"

say ""
say "Building the release bundle. This takes a few minutes."
say ""

# The four signing variables are set on this one command, so only Gradle and
# what it starts can see them; they are never exported into this shell.
# --no-daemon: the Gradle process that received the password exits with the
# build instead of staying up in the background for hours holding it.
# out-of-process: Kotlin compiles in a child process that exits when it is
# done, instead of starting a Kotlin compile daemon that would idle on for up
# to a couple of hours carrying this same environment. It is a little slower,
# and it prints the compiler's warnings with an "exception:" prefix; those are
# warnings, and only "BUILD FAILED" means the build failed.
if ! (
  cd "$HERE"
  MM_KEYSTORE="$KEYSTORE" \
  MM_KEYSTORE_PASSWORD="$store_pw" \
  MM_KEY_ALIAS="$ALIAS" \
  MM_KEY_PASSWORD="$key_pw" \
    ./gradlew --no-daemon -Pkotlin.compiler.execution.strategy=out-of-process bundleRelease
); then
  die "the build failed; the error is just above. Nothing was copied."
fi

[[ -f "$AAB" ]] || die "Gradle finished but there is no bundle at $AAB."

# ---------------------------------------------------------- the checks --

# Signed. build.gradle.kts builds an unsigned release rather than failing when
# it cannot find the keystore, and Play refuses an unsigned upload; this is
# where that would be caught instead.
verify="$("$JARSIGNER" -verify "$AAB" 2>&1 || true)"
if ! printf '%s' "$verify" | grep -q "jar verified"; then
  die "the bundle is not signed. jarsigner said: $(printf '%s' "$verify" | head -n 1)"
fi

# AD_ID. The ads SDK merges this permission into the manifest, and the Play
# Console's advertising-ID answer has to match it (PLAYSTORE.md, App content,
# Advertising ID). The bundle's manifest is binary, so grep reads it as text.
manifest="$(unzip -p "$AAB" base/manifest/AndroidManifest.xml | LC_ALL=C tr -c '[:print:]' '\n' || true)"
ad_id="$(printf '%s' "$manifest" | grep -c 'permission.AD_ID' || true)"

# The AdMob app id. Without a real one the build puts Google's sample id in
# the manifest: the app works, but every ad is a test ad or the house's own.
sample_admob="$(printf '%s' "$manifest" | grep -c 'ca-app-pub-3940256099942544' || true)"

# --------------------------------------------------------------- deliver --

mkdir -p "$OUT_DIR"
cp -f "$AAB" "$OUT_DIR/app-release.aab"

fingerprints="$(MM_KEYSTORE_PASSWORD="$store_pw" "$KEYTOOL" -list -v \
  -keystore "$KEYSTORE" -alias "$ALIAS" -storepass:env MM_KEYSTORE_PASSWORD 2>/dev/null \
  | grep -E '^[[:space:]]*SHA(1|256):' | sed -E 's/^[[:space:]]+//' || true)"

# The password's work is done.
unset -v store_pw key_pw

version_line="$(grep -E '^[[:space:]]*version(Code|Name)[[:space:]]*=' "$HERE/app/build.gradle.kts" \
  | sed -E 's/^[[:space:]]+//' | paste -sd ' ' - || true)"

say ""
rule
say "Done."
say ""
say "  Bundle:  $AAB"
say "  Copied:  $OUT_DIR/app-release.aab"
say "  Version: $version_line"
say ""
say "Upload key fingerprints (public; paste these to Claude):"
if [[ -n "$fingerprints" ]]; then
  printf '%s\n' "$fingerprints" | sed 's/^/  /'
else
  say "  (keytool printed none; run: $KEYTOOL -list -v -keystore $KEYSTORE -alias $ALIAS)"
fi
say ""
if [[ "${ad_id:-0}" -gt 0 ]]; then
  say "AD_ID permission: in the bundle. In Play Console answer \"Yes\" to"
  say "  App content > Advertising ID (purposes: advertising, analytics, fraud prevention)."
else
  say "AD_ID permission: NOT in the bundle. Answer \"No\" to App content > Advertising ID,"
  say "  and take the advertising ID out of the Data safety \"Device or other IDs\" row."
fi
if [[ "${sample_admob:-0}" -gt 0 ]]; then
  say ""
  say "WARNING: the manifest carries Google's SAMPLE AdMob app id, so this build earns"
  say "  nothing from ads. Put ADMOB_APP_ID=ca-app-pub-1179201999959612~9068269365 back in"
  say "  android/gradle.properties and run this again before uploading."
fi
say ""
say "Next: Play Console > Testing > Closed testing > Create release > upload app-release.aab."
say "Keep ~/moneymove-keys backed up. This build did not change it."
rule
