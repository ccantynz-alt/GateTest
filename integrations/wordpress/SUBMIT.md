# WordPress Plugin Directory — Submission Guide

## Pre-submission checklist

- [ ] Plugin is tested on a fresh WordPress install
- [ ] All strings are translatable (wrapped in `__()` / `esc_html__()`)
- [ ] Plugin header is accurate (version, author, license)
- [ ] readme.txt is complete with all sections
- [ ] Screenshots are prepared (see below)
- [ ] Plugin does not include any API keys or credentials

## Screenshots to prepare (required)

Save as `assets/screenshot-1.png`, `screenshot-2.png`, `screenshot-3.png` (min 600px wide):

1. **Scan Results page** — Run a scan on your own repo and screenshot the results table showing PASS/FAIL badges per module
2. **Dashboard Widget** — Screenshot the WordPress dashboard showing the GateTest quality score widget
3. **Settings page** — Screenshot the clean settings form

For the banner (1544×500px): dark background, GateTest logo, tagline "67 AI-powered modules. One gate."
For the icon (256×256px): the GateTest "G" logo on dark background.

## Submission steps

### 1. Create a WordPress.org account (if you don't have one)
Go to: https://login.wordpress.org/register

### 2. Submit the plugin for review
Go to: https://wordpress.org/plugins/developers/add/

Fill in:
- **Plugin name:** GateTest — AI Code Quality Scanner
- **Plugin description:** (paste the short description from readme.txt)
- Upload a `.zip` of the `gatetest/` folder

### 3. Wait for review (typically 1-4 weeks)
The review team checks:
- Security practices
- Proper sanitization/escaping
- License compliance
- readme.txt completeness

You'll receive email notifications on progress.

### 4. After approval — SVN deployment
WordPress plugins use SVN for deployment. After approval:

```bash
# Check out your new plugin repository
svn co https://plugins.svn.wordpress.org/gatetest/ gatetest-svn

# Copy your plugin files to trunk/
cp -r integrations/wordpress/gatetest/* gatetest-svn/trunk/

# Add and commit
cd gatetest-svn
svn add trunk/*
svn commit -m "Initial release 1.0.0"

# Tag the release
svn copy trunk tags/1.0.0
svn commit -m "Tagging version 1.0.0"
```

### 5. Add assets
Copy screenshots and banner to `assets/` and commit via SVN.

## Ongoing maintenance

For updates:
1. Bump `Version:` in `gatetest.php` and `Stable tag:` in `readme.txt`
2. Update `trunk/` via SVN
3. Tag the new version: `svn copy trunk tags/X.Y.Z`

## Plugin directory URL (after approval)

`https://wordpress.org/plugins/gatetest/`
