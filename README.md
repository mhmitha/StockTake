# Stock Take

A very simple stock-taking web app: scan EAN barcodes, watch every scan get
confirmed live, then export the final counts to a spreadsheet.

## How it works

1. Open `index.html` in a browser (double-click it, or serve the folder —
   see below).
2. Click **Start Stock Take**.
3. Scan items with any USB or Bluetooth barcode scanner. Each scan is
   confirmed instantly on screen (a flash and a beep) and added to the live
   list — scan the same EAN again and its quantity just goes up.
4. Click **Complete** when you're done. The app downloads an `.xlsx`
   spreadsheet with two columns, `EAN` and `Quantity`, and resets, ready for
   the next stock take.

No install, no build step, no server required for scanning with a hardware
scanner — it's plain HTML/CSS/JS.

## Running it

- **Simplest:** just double-click `index.html`.
- **To use it from a phone or tablet**, serve the folder instead of opening
  the file directly, e.g. from this directory run:
  ```
  python3 -m http.server 8000
  ```
  then open `http://<your-computer's-ip>:8000` on the device (same Wi-Fi
  network).

## Using a physical barcode scanner

This app expects a scanner in standard "USB/Bluetooth HID keyboard" mode —
the factory default for essentially every handheld barcode scanner. It just
types the digits and sends Enter, exactly like someone typing on a keyboard,
so there's nothing to configure beyond plugging it in or pairing it. If your
scanner is set to a different keyboard layout than your computer, digits can
come through wrong — make sure both are set the same way (usually "US").

You can also type an EAN in by hand via "+ Enter an EAN manually" — handy
for fixing a bad scan or testing without a scanner.

## Correcting mistakes

Every row has `−` / `+` buttons to adjust its quantity, and a `✕` to remove
it outright. Reducing quantity to 0 removes the row. Scans that don't look
like a valid EAN (digits only, 6–14 long) are rejected with a red flash and
are never added to the list.

## If your browser or tab closes mid-count

Progress is saved automatically in the browser's local storage as you scan.
Reopening the page offers to resume the unfinished stock take, or discard it
and start fresh.

## Output format

The exported file is a real `.xlsx` workbook (built with the bundled
[SheetJS](https://sheetjs.com) library, `vendor/xlsx.full.min.js`,
Apache-2.0 licensed — see `vendor/LICENSE-xlsx.txt`), named
`stocktake_YYYY-MM-DD_HHmm.xlsx`, with one row per EAN sorted numerically.
The EAN column is stored as text so leading zeros and long barcodes are
never corrupted when opened in Excel.
