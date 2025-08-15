# Collaborative E2E Encrypted Case Tracker

This web app demonstrates a simple case list for medical professionals. Each case contains its own task list and free-text notes. All case titles, tasks, comments and notes are encrypted in the browser with a shared passphrase, so Firestore only stores ciphertext.

## Setup

1. Enable Firestore and Anonymous Auth in your Firebase project.
2. Deploy the security rules from [`firestore.rules`](firestore.rules) or configure equivalent rules in the Firebase console.
3. Serve the static files (e.g., with `npx serve`, GitHub Pages, or any HTTPS static host).
4. Open `index.html` in each browser or device.

## Usage

When prompted, enter a username and the shared passphrase on every device. Cases, tasks and notes you add are encrypted with AES-GCM and written to the `cases` collection in Firestore. Devices using the same passphrase decrypt and display the shared data. Information created with different passphrases remains unreadable and is ignored.
