#!/usr/bin/env bash
# ==============================================================================
# Abbadon Linux Universal One-Line Installer
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/Xertoo/Abbadon/main/scripts/install-linux.sh | bash
# ==============================================================================
set -e

REPO="Xertoo/Abbadon"
APP_NAME="Abbadon"
BIN_NAME="abbadon"

echo ""
echo "  █████╗ ██████╗ ██████╗  █████╗ ██████╗  ██████╗ ███╗   ██╗"
echo " ██╔══██╗██╔══██╗██╔══██╗██╔══██╗██╔══██╗██╔═══██╗████╗  ██║"
echo " ███████║██████╔╝██████╔╝███████║██║  ██║██║   ██║██╔██╗ ██║"
echo " ██╔══██║██╔══██╗██╔══██╗██╔══██║██║  ██║██║   ██║██║╚██╗██║"
echo " ██║  ██║██████╔╝██████╔╝██║  ██║██████╔╝╚██████╔╝██║ ╚████║"
echo " ╚═╝  ╚═╝╚═════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝  ╚═════╝ ╚═╝  ╚═══╝"
echo ""
echo "🎧 Desktop SoundCloud player with rate-limit protection & P2P sync"
echo "------------------------------------------------------------------"

# Detect distribution
if [ -f /etc/os-release ]; then
    . /etc/os-release
    DISTRO=$ID
    DISTRO_LIKE=${ID_LIKE:-""}
else
    DISTRO="unknown"
    DISTRO_LIKE=""
fi

echo "🔍 Detected Distribution: $DISTRO ($DISTRO_LIKE)"

# Ensure curl is installed
if ! command -v curl &> /dev/null; then
    echo "❌ 'curl' is required. Please install curl first."
    exit 1
fi

# Determine latest release version from GitHub API
echo "🌐 Fetching latest release information..."
RELEASE_JSON=$(curl -s "https://api.github.com/repos/${REPO}/releases/latest" || true)

if echo "$RELEASE_JSON" | grep -q '"tag_name":'; then
    VERSION=$(echo "$RELEASE_JSON" | grep '"tag_name":' | head -n1 | sed -E 's/.*"tag_name": "([^"]+)".*/\1/')
    echo "✓ Latest version found: $VERSION"
else
    VERSION="v1.0.11"
    echo "ℹ Fallback to default version: $VERSION"
fi

TMP_DIR=$(mktemp -d /tmp/abbadon-install.XXXXXX)
trap 'rm -rf "$TMP_DIR"' EXIT

# Install dependencies and application based on distribution
case "$DISTRO" in
    arch|manjaro|endeavouros|garuda|artix)
        echo "📦 Arch Linux detected."
        echo "Installing system dependencies via pacman..."
        sudo pacman -Sy --needed --noconfirm alsa-lib gtk3 libnotify nss libxtst yt-dlp curl

        echo "⬇ Downloading Abbadon AppImage for Arch Linux..."
        APPIMAGE_URL=$(echo "$RELEASE_JSON" | grep -o 'https://[^"]*Abbadon-[^"]*x86_64\.AppImage' | head -n1 || true)
        if [ -z "$APPIMAGE_URL" ]; then
            APPIMAGE_URL="https://github.com/${REPO}/releases/download/${VERSION}/Abbadon-${VERSION#v}-x86_64.AppImage"
        fi

        DEST_BIN="/usr/local/bin/${BIN_NAME}"
        sudo curl -fsSL "$APPIMAGE_URL" -o "$DEST_BIN"
        sudo chmod +x "$DEST_BIN"

        # Install Desktop icon and menu entry
        sudo mkdir -p /usr/local/share/applications /usr/local/share/icons/hicolor/512x512/apps
        sudo curl -fsSL "https://raw.githubusercontent.com/${REPO}/main/build/icon.png" -o "/usr/local/share/icons/hicolor/512x512/apps/${BIN_NAME}.png"

        sudo tee /usr/local/share/applications/${BIN_NAME}.desktop > /dev/null <<EOF
[Desktop Entry]
Name=Abbadon
Comment=Desktop SoundCloud player with rate-limit protection
Exec=${DEST_BIN} %U
Icon=${BIN_NAME}
Terminal=false
Type=Application
Categories=AudioVideo;Audio;Player;Music;
StartupWMClass=abbadon
MimeType=x-scheme-handler/abbadon;
EOF
        sudo update-desktop-database /usr/local/share/applications || true
        ;;

    debian|ubuntu|pop|linuxmint|elementary|zorin)
        echo "📦 Debian / Ubuntu family detected."
        echo "Installing system dependencies..."
        sudo apt-get update -qq
        sudo apt-get install -y --no-install-recommends libasound2 libnotify4 libnss3 libxtst6 curl || true

        echo "⬇ Downloading Debian package (.deb)..."
        DEB_URL=$(echo "$RELEASE_JSON" | grep -o 'https://[^"]*abbadon_[^"]*_amd64\.deb' | head -n1 || true)
        if [ -z "$DEB_URL" ]; then
            DEB_URL="https://github.com/${REPO}/releases/download/${VERSION}/abbadon_${VERSION#v}_amd64.deb"
        fi

        DEB_FILE="${TMP_DIR}/abbadon.deb"
        curl -fsSL "$DEB_URL" -o "$DEB_FILE"

        echo "Installing .deb package..."
        sudo apt-get install -y "$DEB_FILE" || sudo dpkg -i "$DEB_FILE"
        ;;

    fedora|rhel|centos|rocky|almalinux)
        echo "📦 Fedora / RHEL family detected."
        echo "Installing system dependencies..."
        sudo dnf install -y alsa-lib gtk3 libnotify nss libXtst curl || true

        echo "⬇ Downloading RPM package (.rpm)..."
        RPM_URL=$(echo "$RELEASE_JSON" | grep -o 'https://[^"]*abbadon-[^"]*\.x86_64\.rpm' | head -n1 || true)
        if [ -z "$RPM_URL" ]; then
            RPM_URL="https://github.com/${REPO}/releases/download/${VERSION}/abbadon-${VERSION#v}.x86_64.rpm"
        fi

        RPM_FILE="${TMP_DIR}/abbadon.rpm"
        curl -fsSL "$RPM_URL" -o "$RPM_FILE"

        echo "Installing .rpm package..."
        sudo dnf install -y "$RPM_FILE"
        ;;

    *)
        echo "📦 Generic Linux installation via universal AppImage..."
        APPIMAGE_URL=$(echo "$RELEASE_JSON" | grep -o 'https://[^"]*Abbadon-[^"]*x86_64\.AppImage' | head -n1 || true)
        if [ -z "$APPIMAGE_URL" ]; then
            APPIMAGE_URL="https://github.com/${REPO}/releases/download/${VERSION}/Abbadon-${VERSION#v}-x86_64.AppImage"
        fi

        INSTALL_DIR="${HOME}/.local/bin"
        mkdir -p "$INSTALL_DIR"
        DEST_BIN="${INSTALL_DIR}/${BIN_NAME}"

        curl -fsSL "$APPIMAGE_URL" -o "$DEST_BIN"
        chmod +x "$DEST_BIN"

        # Desktop entry in ~/.local/share/applications
        DESKTOP_DIR="${HOME}/.local/share/applications"
        ICON_DIR="${HOME}/.local/share/icons/hicolor/512x512/apps"
        mkdir -p "$DESKTOP_DIR" "$ICON_DIR"

        curl -fsSL "https://raw.githubusercontent.com/${REPO}/main/build/icon.png" -o "${ICON_DIR}/${BIN_NAME}.png"

        cat <<EOF > "${DESKTOP_DIR}/${BIN_NAME}.desktop"
[Desktop Entry]
Name=Abbadon
Comment=Desktop SoundCloud player with rate-limit protection
Exec=${DEST_BIN} %U
Icon=${BIN_NAME}
Terminal=false
Type=Application
Categories=AudioVideo;Audio;Player;Music;
StartupWMClass=abbadon
MimeType=x-scheme-handler/abbadon;
EOF
        ;;
esac

echo ""
echo "🎉 ========================================================="
echo "✓ Abbadon has been successfully installed!"
echo "  Launch it from your application menu or run in terminal:"
echo "    ${BIN_NAME}"
echo "========================================================="
echo ""
