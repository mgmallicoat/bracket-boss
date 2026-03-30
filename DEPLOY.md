# Bracket Boss — Deployment Instructions

These instructions will get your app live at a public URL in about 10 minutes.
No coding experience needed — just copy and paste.

---

## What you'll need

- A free GitHub account (github.com)
- A free Vercel account (vercel.com)
- Node.js installed on your computer (nodejs.org — download the "LTS" version)

---

## Step 1 — Install Node.js (if you don't have it)

1. Go to https://nodejs.org
2. Click the big green "LTS" download button
3. Run the installer, click through all the defaults
4. Restart your computer

---

## Step 2 — Set up the project on your computer

1. Unzip the `bracket-boss.zip` file somewhere easy to find (like your Desktop)
2. Open **Terminal** (Mac: press Cmd+Space, type "Terminal", hit Enter)
   — or **Command Prompt** on Windows (press Win+R, type "cmd", hit Enter)
3. Navigate to the folder. Type this and hit Enter (replace the path with wherever you unzipped it):
   ```
   cd ~/Desktop/bracket-boss
   ```
4. Install dependencies by typing this and hitting Enter:
   ```
   npm install
   ```
   You'll see a bunch of text scroll by — that's normal. Wait for it to finish.

5. Test it locally (optional but recommended):
   ```
   npm run dev
   ```
   Then open http://localhost:5173 in your browser. You should see Bracket Boss!
   Press Ctrl+C in the terminal when done.

---

## Step 3 — Put the code on GitHub

GitHub is where your code lives online. Vercel will read it from there.

1. Go to https://github.com and create a free account (or sign in)
2. Click the **+** button in the top right → **New repository**
3. Name it `bracket-boss`
4. Leave everything else as default, click **Create repository**
5. GitHub will show you a page with setup instructions. Look for the section
   that says **"…or push an existing repository from the command line"**
6. Copy those three lines (they'll look something like this, but with YOUR username):
   ```
   git remote add origin https://github.com/YOURNAME/bracket-boss.git
   git branch -M main
   git push -u origin main
   ```
7. Back in Terminal, in your bracket-boss folder, run these commands one at a time:
   ```
   git init
   git add .
   git commit -m "Initial commit"
   ```
   Then paste and run the three lines from GitHub.
8. Refresh your GitHub page — you should see your files listed there!

---

## Step 4 — Deploy to Vercel

Vercel will build and host your app for free, and give you a public URL.

1. Go to https://vercel.com and click **Sign Up**
2. Choose **Continue with GitHub** — this connects your accounts
3. Once logged in, click **Add New → Project**
4. You'll see your GitHub repos listed. Click **Import** next to `bracket-boss`
5. Vercel will auto-detect the settings (it knows Vite). Just click **Deploy**
6. Wait about 60 seconds while it builds…
7. 🎉 You'll get a URL like `bracket-boss-yourname.vercel.app` — that's your app!

Click **Visit** to open it. Share that URL with anyone!

---

## Updating the app in the future

When you get new code from Claude:
1. Replace `src/App.jsx` with the new version
2. In Terminal, run:
   ```
   git add .
   git commit -m "Update app"
   git push
   ```
3. Vercel automatically re-deploys within about 30 seconds

---

## Important notes

- **Each person's data is their own** — localStorage is per-browser, so your
  tournament data stays on your device. Other people who visit your URL start fresh.
  This is fine for personal use and sharing with other parents to try it out.

- **The AI team-name extraction feature** uses the Anthropic API and will work
  from the deployed URL the same way it does in Claude.

- **Your URL is public** — anyone with the link can use the app. There's no
  password. That's fine for a tool like this, but don't put sensitive info in it.

---

## Stuck? Common fixes

**"npm: command not found"** → Node.js isn't installed yet. Go back to Step 1.

**"git: command not found"** → Install Git from https://git-scm.com/downloads

**Vercel build fails** → Make sure all the files from the zip are present,
especially `vite.config.js` and `src/main.jsx`.

**The app loads but looks broken** → Hard-refresh your browser: Cmd+Shift+R (Mac)
or Ctrl+Shift+R (Windows).

---

## Installing on your iPhone (PWA)

Once deployed to Vercel, you and your beta testers can install it like a real app:

1. Open the Vercel URL in **Safari** on your iPhone (must be Safari, not Chrome)
2. Tap the **Share** button (the box with an arrow pointing up)
3. Scroll down and tap **"Add to Home Screen"**
4. Tap **Add** in the top right
5. The Bracket Boss icon will appear on your home screen
6. Tap it — it opens full screen with no browser bar, just like a native app

Share these same steps with your beta testers along with your Vercel URL.

**Note:** Each person's tournament data stays on their own device.
