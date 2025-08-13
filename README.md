
# Collaborative E2E Encrypted Note App

This web app lets multiple devices share notes through a lightweight Node server.
Notes are encrypted in the browser with a shared passphrase so the server cannot
read them.

## Setup

1. Run `node server.js` to start the server on port 3000.
2. Open `http://localhost:3000` in each browser or device.
3. When prompted, enter the same passphrase on every device to decrypt shared notes.

## Usage

Type a note and click **Add Note**. The note is encrypted and sent to the server
so it appears on other devices using the same passphrase. Use the Delete button
to remove a note from the shared store.


If the server contains notes created with a different passphrase, they will be
ignored when you load notes with your current passphrase. This prevents old or
undecryptable entries from blocking the display of notes you can read.

