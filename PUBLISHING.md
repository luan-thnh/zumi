# Publishing Zumi to extensions.gnome.org

Zumi includes a source package for development and a separate EGO packaging path for the GNOME Extensions website.

## Maintainer requirement

This project was developed with AI assistance. Do not submit it to extensions.gnome.org until you understand the JavaScript/GJS code well enough to debug it, answer reviewer questions, and maintain it across GNOME Shell releases.

## Important: source code URL is mandatory

The GNOME Extensions upload site requires `metadata.json` to contain a working
`url` pointing to the **actual public project** (ideally its GitHub/GitLab
repository and issue tracker). Do not replace this with a fake placeholder or
another project's website. `./scripts/pack-ego.sh` intentionally refuses to
build the website ZIP until `ZUMI_REPOSITORY_URL` is provided.

For private/local installation, run `./scripts/install.sh` or install the
separate local extension ZIP. The local ZIP does not require a public URL.

The internal GNOME UUID remains `lumalens@luanthnh.dev`; do not change it during
this rename, or you may lose stored settings and upgrade continuity.

## Before upload

1. Create a public GitHub or GitLab repository with an issue tracker.
2. Push this source tree to the repository.
3. Keep the UUID `lumalens@luanthnh.dev` unchanged once the first EGO version is uploaded.
4. Test the release on the Shell versions listed in `metadata.json`.
5. Run `npm run verify` and `node scripts/ego-preflight.mjs`.
6. Zumi declares clipboard access in `metadata.json`. Clipboard keyboard shortcuts are disabled by default and require an explicit opt-in in Preferences.
7. Do not bundle `schemas/gschemas.compiled` for GNOME 50.
8. The EGO ZIP intentionally excludes tests, local install scripts, README files and branding assets that are not required at runtime.

## Build the EGO upload ZIP

Use your real repository URL:

```bash
ZUMI_REPOSITORY_URL=https://github.com/YOUR_ACCOUNT/zumi \
  ./scripts/pack-ego.sh
```

The generated file is:

```text
dist-ego/lumalens@luanthnh.dev.zip
```

`metadata.json` and `extension.js` are at the root of that ZIP. The packaging script removes the deprecated local `version` field and injects the repository URL.

## Upload

1. Register/log in on extensions.gnome.org.
2. Open **Add yours**.
3. Upload `dist-ego/lumalens@luanthnh.dev.zip`.
4. Wait for volunteer review.
5. If a reviewer requests changes, fix them and upload the replacement using **Add yours** again with the same UUID.

## Store icon

The top bar and menu render the Beacon mark with `St.Icon` and scale-aware SVG files. The top bar selects an explicit light or dark SVG based on the Shell theme; the menu uses its own blue SVG. The panel button applies 6px horizontal padding only to Zumi. The monochrome `icons/zumi-symbolic.svg` remains available for branding and packaging.

For the extension page artwork use:

- `icons/zumi.svg` (vector source)
- `branding/zumi-store-icon.png` (512px preview)

The store artwork is deliberately excluded from the EGO ZIP because it is not needed by the extension at runtime. On the extension page, use the site's icon control to set the square artwork.

## GNOME 50 local release test

After installing a build on a real Wayland session, log out/in once so the Shell process loads the new modules. Then verify:

```bash
gnome-extensions info lumalens@luanthnh.dev
journalctl -b -o cat /usr/bin/gnome-shell | grep -Ei 'lumalens|JS ERROR|TypeError|ReferenceError|SyntaxError'
```

Test Ctrl+1 through Ctrl+8, top-bar actions, Preferences, timer restore, recording and both clipboard opt-in states before submission.
