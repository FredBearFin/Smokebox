# Reaching the Smokebox server

Plain steps for the owner. The server runs the app at `https://<server-ip-with-dashes>.sslip.io/` behind a login.

## Installing or updating (in the Hetzner web console, nothing to paste)
The console cannot paste, so the installer is one short line to type:

    curl -fsSL https://raw.githubusercontent.com/FredBearFin/SmokeBoxKDS/deploy/go.sh -o go.sh && bash go.sh freddy YOURPASSWORD

It installs the app and HTTPS, and turns on a nightly update at 4:30 AM server time (the `smokebox-update` timer). To update right away, type `systemctl start smokebox-update`. Saved data in `/var/lib/smokebox` is never deleted by an update: a copy is kept as `state.json.before-update`, and if the new build fails (or cannot read the data) the old build and that copy are put back.

## If your network blocks the server's address
Some buildings and offices block addresses like the server's. The fix is a second address that goes through Cloudflare. In the console, type:

    curl -fsSL https://raw.githubusercontent.com/FredBearFin/SmokeBoxKDS/deploy/tunnel.sh -o tunnel.sh && bash tunnel.sh

It prints an address like `https://some-words.trycloudflare.com`. Sign in with the same login. To see the address again, type `smokebox-url`. The address changes when the tunnel restarts (for example after a reboot). To remove it: `systemctl disable --now smokebox-tunnel`.

Honest limits: Cloudflare offers these quick addresses for testing and gives no uptime promise. A real, stable address needs your own domain name (a few dollars a year) and a free Cloudflare account; that is the right choice before a real kitchen depends on it. The tunnel script has been syntax-checked but not yet run on a real server.

## Phone data
The app is one page that works offline once opened. If the building blocks the server, open the address once on your phone's mobile data and add it to the home screen.

## Things that are not safe to leave as they are
- The login password was pasted into a chat at setup time: pick a new one by rerunning `go.sh` with a new password.
- The `deploy` branch is public. Anyone can read the app. Anyone who can push to it changes what the nightly update installs.
