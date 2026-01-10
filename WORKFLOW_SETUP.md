# GitHub Actions Workflow Setup Guide

## Changes Made

The workflow file `.github/workflows/build.yml` has been updated to be compatible with your project. Here are the key changes:

### 1. **Added Windows ARM64 Build**
   - Added `windows-latest` with `arm64` architecture to the build matrix
   - Your `package.json` already has the `build:win:arm64` script configured

### 2. **Fixed Dependency Installation**
   - Changed from `npm install --no-optional` to `npm install` to properly install `dmg-license` (which is in optionalDependencies)
   - The `dmg-license` package is still manually installed on macOS as a backup

### 3. **Removed Redundant Build Step**
   - Removed the duplicate `npm run dist` step since your build scripts already include it (`build:win:x64`, etc. all run `dist` first)

### 4. **Improved Windows Artifact Handling**
   - Simplified Windows artifact collection to handle all `.exe` and `.blockmap` files
   - Properly compresses unpacked folders based on architecture

### 5. **Enhanced Tag Creation**
   - Now uses version from `package.json` (currently `1.0.2`) to create tags like `v1.0.2`
   - Automatically appends timestamp if tag already exists (e.g., `v1.0.2-20240101120000`)
   - Fetches remote tags before checking to avoid conflicts

## Required Setup: GitHub Personal Access Token (PAT)

You need to create and configure a GitHub Personal Access Token (PAT) for this workflow to work.

### Step 1: Create a Personal Access Token

1. Go to GitHub.com → Settings → Developer settings → Personal access tokens → Tokens (classic)
   - Or visit: https://github.com/settings/tokens
2. Click "Generate new token" → "Generate new token (classic)"
3. Give it a name (e.g., "StreamGo Release Workflow")
4. Set expiration (recommended: 90 days or custom)
5. Select these scopes/permissions:
   - ✅ **repo** (Full control of private repositories)
     - This includes: `repo:status`, `repo_deployment`, `public_repo`, `repo:invite`, `security_events`
   - ✅ **workflow** (Update GitHub Action workflows)
6. Click "Generate token"
7. **COPY THE TOKEN IMMEDIATELY** - you won't be able to see it again!

### Step 2: Add Token as Repository Secret

1. Go to your repository: https://github.com/Bo0ii/StreamGo (or your actual repo URL)
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **"New repository secret"**
4. Name: `GH_PAT` (exactly as shown - case sensitive)
5. Value: Paste your token
6. Click **"Add secret"**

### Step 3: Verify Repository Name

The workflow uses `${{ github.repository }}` which will automatically resolve to `Bo0ii/StreamGo` (or your actual username/repo).

If your repository name is different, you may need to update:
- Line 88-89 in `package.json` (the `build.publish` section)
- Or ensure the GitHub repository URL matches what's in `package.json`

## Important Notes

### Build Matrix
The workflow builds for:
- ✅ Linux x64
- ✅ Linux ARM64  
- ✅ macOS x64
- ✅ macOS ARM64
- ✅ Windows x64
- ✅ Windows ARM64

### Version Tagging
- Tags are created from your `package.json` version field (currently `1.0.2`)
- Tag format: `v1.0.2` (automatically prepends `v`)
- If a tag already exists, it appends a timestamp: `v1.0.2-20240101120000`

### Electron Builder Configuration
Your `package.json` already has electron-builder configured with:
- Output directory: `release-builds`
- GitHub publisher: `Bo0ii/StreamGo`
- Windows targets: NSIS (x64, arm64) and Portable (x64)
- macOS targets: DMG
- Linux targets: AppImage

### Running the Workflow

1. Go to your repository on GitHub
2. Click the **"Actions"** tab
3. Select **"Build and Publish Electron App"** workflow
4. Click **"Run workflow"** button
5. Select branch (usually `main` or `master`)
6. Click **"Run workflow"**

The workflow will:
1. Build your app for all platforms/architectures in parallel
2. Upload build artifacts
3. Create a GitHub release with all artifacts attached
4. Tag the release with the version from `package.json`

## Troubleshooting

### Issue: "GH_PAT secret not found"
- Make sure you've added the secret with the exact name `GH_PAT`
- Check that it's in: Repository Settings → Secrets and variables → Actions

### Issue: "Permission denied" when pushing tags
- Verify your PAT has `repo` scope enabled
- Make sure the token hasn't expired

### Issue: "Tag already exists"
- The workflow will automatically append a timestamp if the tag exists
- Or manually delete the existing tag: `git push origin :refs/tags/v1.0.2`

### Issue: Build fails on macOS/Linux
- Ensure `dmg-license` installs correctly (it's optional, but needed for DMG builds)
- Check that all native dependencies can be rebuilt with `@electron/rebuild`

## Testing Locally

Before running the full workflow, test builds locally:

```bash
# Test Windows x64 build
npm run build:win:x64

# Test Windows ARM64 build  
npm run build:win:arm64

# Test macOS x64 build
npm run build:mac:x64

# Test Linux x64 build
npm run build:linux:x64
```

All builds should output to the `release-builds` directory.
