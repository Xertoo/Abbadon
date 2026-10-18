# 🚀 How to Publish Updates for All Abbadon Users

Abbadon is equipped with **`electron-updater`**. Every user running an installed copy of Abbadon automatically receives update alerts on launch and can upgrade seamlessly in one click.

---

## ⚙️ Step 1: Configure Your GitHub Repository (One-Time Setup)

In `package.json`, under `"build"` -> `"publish"`, configure your GitHub username and repository name:

```json
"publish": [
  {
    "provider": "github",
    "owner": "Xertoo",
    "repo": "abbadon",
    "private": false
  }
]
```

---

## 📦 Method 1: Local Release Script (Simplest)

1. Run **`publish-update.bat`** (located in the project root).
2. The script prompts you for the new version number (e.g. `1.0.1`). Enter it and press Enter.
3. The script automatically:
   - Updates `package.json` with the new version.
   - Runs `npm run build` (`tsc && vite build`).
   - Packages the Windows installer and update manifest into `release/`:
     - `Abbadon Setup 1.0.1.exe`
     - `latest.yml`
4. Go to your GitHub repository -> **Releases** tab -> **Draft a new release**:
   - Tag: `v1.0.1`
   - Release title: `Abbadon v1.0.1`
   - Drag & drop both `Abbadon Setup 1.0.1.exe` and `latest.yml` into the binaries section.
   - Click **Publish release**.

**Done!** When users open Abbadon (or click "Check for Updates" in Settings), they will receive an in-app banner:
> *"Update is ready to install! [Restart & Install]"*

---

## ⚡ Method 2: GitHub Actions Automated CI/CD (Zero Local Overhead)

The project includes a ready-to-run workflow at `.github/workflows/release.yml`.

Whenever you push a git tag matching `v*`:
```bash
git tag v1.0.1
git push origin v1.0.1
```
Or trigger it manually in GitHub -> **Actions** -> **Release Desktop App** -> **Run workflow**.

GitHub's runners will compile the code, build the Windows binaries, and publish the release automatically.
