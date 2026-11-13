# My To-Do List

A simple to-do list website. Add tasks, check them off, and delete them.

Live site: https://larryatcrosstwin.github.io/LC-Workflow/

## Syncing between devices

Once Firebase is set up (below), you sign in with Google and see the same
tasks on every device, updating live. Until then, tasks are saved in each
browser separately ("this device only" mode). Any tasks already saved on a
device are copied to your account the first time you sign in there.

### One-time Firebase setup

1. Go to https://console.firebase.google.com and click **Create a project**
   (any name, e.g. `lc-todo`). Google Analytics is not needed.
2. **Add a web app:** on the project overview page click the **</>** (Web)
   icon, give it a nickname, and click **Register app** (skip Firebase Hosting).
   Copy the values shown in `firebaseConfig` into `firebase-config.js`.
3. **Turn on Google sign-in:** Build → **Authentication** → Get started →
   Sign-in method → **Google** → Enable → Save.
4. **Allow the website to sign in:** Authentication → **Settings** →
   Authorized domains → Add domain → `larryatcrosstwin.github.io`.
5. **Create the database:** Build → **Firestore Database** → Create database →
   pick a location → start in **production mode**.
6. **Lock it down:** in Firestore, open the **Rules** tab, replace everything
   with the contents of `firestore.rules`, and click **Publish**.

The values in `firebase-config.js` are safe to have in a public repository.
The rules in `firestore.rules` are what make sure only you can see your tasks.

## Files

- `index.html` – the page structure
- `style.css` – how it looks (works on phones and computers, supports dark mode)
- `app.js` – how it works (adding, checking off, deleting, saving and syncing tasks)
- `firebase-config.js` – your Firebase project settings
- `firestore.rules` – database security rules (paste into the Firebase console)

## Running it on your computer

Because the app uses JavaScript modules, open it through a small local web
server instead of double-clicking `index.html`, for example:

```bash
python3 -m http.server 8000
```

Then visit http://localhost:8000. Google sign-in also needs `localhost` in
Firebase's authorized domains (it is there by default).
