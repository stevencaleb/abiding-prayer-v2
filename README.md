# Abiding Prayer

A contemplative ministry companion for prayer, surrender, and steady awareness of God's presence. Built as a Progressive Web App with React + Vite + Tailwind.

## Deploy to Vercel (from a fresh GitHub repo)

1. Create a new empty repository on GitHub (e.g. `abiding-prayer`).
2. On the new repo's main page, click **Add file → Upload files**.
3. Drag the contents of this folder (everything inside `abiding-prayer/`) into the upload area. Make sure folder structure is preserved — `src/`, `public/`, and the root files (`package.json`, `index.html`, etc.) all go in.
4. Commit.
5. Go to [vercel.com](https://vercel.com), click **Add New → Project**, and import your GitHub repo.
6. Vercel will auto-detect Vite. Leave all settings at defaults and click **Deploy**.
7. Once deployed, you can open the URL Vercel gives you on your phone and add to home screen.

## After deploy: copy your icons over

This zip does not include the app icons or favicon. Copy these from your old repo's `public/` folder into your new repo's `public/` folder:

- `favicon.ico`
- `favicon.png`
- `icons/icon-192.png`
- `icons/icon-512.png`
- `splash-dark.png` (optional)
- `splash-light.png` (optional)

Without these, the app still works but the home-screen icon will be a generic placeholder.

## Local development

```
npm install
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173).

To build for production:

```
npm run build
```

Output goes to `dist/`.

## Project structure

```
abiding-prayer/
├── index.html              # Vite entry HTML (at root, not in public/)
├── package.json
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
├── public/                 # Static assets served as-is
│   ├── manifest.json
│   ├── sw.js               # Service worker
│   ├── favicon.ico         # (you supply)
│   └── icons/              # (you supply)
└── src/
    ├── main.jsx            # App entry point
    ├── App.jsx             # All UI + feedback engine
    └── index.css           # Tailwind imports + iOS tweaks
```

Journal entries live in the user's browser via `localStorage` and never leave the device.
