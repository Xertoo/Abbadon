#!/usr/bin/env bash
# Abbadon Linux Quick Installer
set -e

echo "=== Abbadon Linux Installer ==="

# Detect distro
if [ -f /etc/os-release ]; then
    . /etc/os-release
    DISTRO=$ID
else
    DISTRO="unknown"
fi

echo "Detected OS: $DISTRO"

# Check dependencies
case "$DISTRO" in
    arch|manjaro|endeavouros)
        echo "Installing recommended dependencies for Arch Linux..."
        sudo pacman -Sy --needed --noconfirm alsa-lib gtk3 libnotify nss libxtst yt-dlp
        ;;
    debian|ubuntu|pop|linuxmint)
        echo "Installing recommended dependencies for Debian/Ubuntu..."
        sudo apt-get update
        sudo apt-get install -y libasound2 libgtk-3-0 libnotify4 libnss3 libxtst6 yt-dlp || true
        ;;
    fedora|rhel|centos)
        echo "Installing recommended dependencies for Fedora/RHEL..."
        sudo dnf install -y alsa-lib gtk3 libnotify nss libXtst yt-dlp || true
        ;;
    *)
        echo "Please ensure alsa-lib, gtk3, libnotify, nss, libxtst, and yt-dlp are installed."
        ;;
esac

echo "Dependencies ready! You can run Abbadon using:"
echo "  • Arch Linux:   chmod +x release/Abbadon-*.AppImage && ./release/Abbadon-*.AppImage (or makepkg -si in packaging/arch)"
echo "  • Debian/Ubuntu: sudo apt install ./release/abbadon_*.deb"
echo "  • Fedora/RHEL:  sudo dnf install ./release/abbadon-*.rpm"
echo "  • AppImage:     chmod +x release/Abbadon-*.AppImage && ./release/Abbadon-*.AppImage"
echo "=== Done ==="
