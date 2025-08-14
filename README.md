
# Collaborative E2E Encrypted Note App

This web app stores notes in Firebase Firestore. Notes are encrypted in the browser with a shared passphrase, so the database only sees ciphertext.

## Setup

1. Enable Firestore and Anonymous Auth in your Firebase project.
2. Deploy the security rules from [`firestore.rules`](firestore.rules) or configure equivalent rules in the Firebase console.
3. Serve the static files (e.g., with `npx serve`, GitHub Pages, or any HTTPS static host).
4. Open `index.html` in each browser or device.

## Usage

When prompted, enter the same passphrase on every device. Each note you add is encrypted with AES-GCM and written to the `notes` collection in Firestore. Devices using the same passphrase decrypt and display the shared notes. Notes created with different passphrases remain unreadable and are ignored.

