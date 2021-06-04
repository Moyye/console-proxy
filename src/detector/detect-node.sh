#!/bin/bash

# Currently known to support:
#   - x64 (x86_64)
#   - x86 (i386)
#   - armv6l (Raspbian on Pi 1/Zero)
#   - armv7l (Raspbian on Pi 2/3)
detect_arch() {
  local arch="$(uname -m | tr '[:upper:]' '[:lower:]')"

  if echo "${arch}" | grep -i arm >/dev/null; then
    # ARM is fine
    echo "${arch}"
  else
    if [ "${arch}" = "i386" ]; then
      arch=x86
    elif [ "${arch}" = "x86_64" ]; then
      arch=x64
    elif [ "${arch}" = "aarch64" ]; then
      arch=arm64
    fi

    # `uname -m` in some cases mis-reports 32-bit OS as 64-bit, so double check
    if [ "${arch}" = "x64" ] && [ "$(getconf LONG_BIT)" -eq 32 ]; then
      arch=x86
    fi

    echo "${arch}"
  fi
}

# Currently known to support:
#   - win (Git Bash)
#   - darwin
#   - linux
#   - linux_musl (Alpine)
detect_platform() {
  local platform="$(uname -s | tr '[:upper:]' '[:lower:]')"

  # check for MUSL
  if [ "${platform}" = "linux" ]; then
    if ldd /bin/sh | grep -i musl >/dev/null; then
      platform=linux_musl
    fi
  fi

  # mingw is Git-Bash
  if echo "${platform}" | grep -i mingw >/dev/null; then
    platform=win
  fi

  echo "${platform}"
}

# Currently known to support:
#   - x64 (x86_64)
#   - x86 (i386)
#   - armv6l (Raspbian on Pi 1/Zero)
#   - armv7l (Raspbian on Pi 2/3)
detect_arch() {
  local arch="$(uname -m | tr '[:upper:]' '[:lower:]')"

  if echo "${arch}" | grep -i arm >/dev/null; then
    # ARM is fine
    echo "${arch}"
  else
    if [ "${arch}" = "i386" ]; then
      arch=x86
    elif [ "${arch}" = "x86_64" ]; then
      arch=x64
    elif [ "${arch}" = "aarch64" ]; then
      arch=arm64
    fi

    # `uname -m` in some cases mis-reports 32-bit OS as 64-bit, so double check
    if [ "${arch}" = "x64" ] && [ "$(getconf LONG_BIT)" -eq 32 ]; then
      arch=x86
    fi

    echo "${arch}"
  fi
}

VERSION="v8.17.0"
PLATFORM="$(detect_platform)"
ARCH="$(detect_arch)"
EXT=tar.gz
if [ "${PLATFORM}" = win ]; then
  EXT=zip
fi

URL="node-${VERSION}-${PLATFORM}-${ARCH}.tar.gz"
echo "${URL}"
