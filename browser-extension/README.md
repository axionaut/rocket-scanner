# Kite Basket Bridge

One-time setup in Chrome or Edge (the same browser/profile used for both apps):

1. Open `chrome://extensions` or `edge://extensions` and enable Developer mode.
2. Choose **Load unpacked** and select this `browser-extension` folder.
3. Reload Rocket Scanner and Kite.

Keep any Kite page open and logged in, in the same browser; the basket does **not** need to be open. Rocket Scanner writes each new funded basket into **Scanner_Buy** (created if missing) through Kite's own basket API, right after its normal file save. The **Kite auto-send** button resends on demand. Pending transfers retry every 20 seconds using the current live plan. The bridge verifies every item, quantity and GTT target before reporting success. Open the basket when you want to review it and click Execute yourself.

An identical basket is left alone. A basket with older orders is replaced by the new plan, unless Scanner_Buy is open on screen in Kite. Close it and the next retry writes the new plan. Other baskets are never touched.

Version 1.5.0 adds confirmed-fill cleanup: after the helper reports a dip-buy fill, Rocket Scanner removes that stock's CNC BUY entries from Scanner_Buy, including refreshing an open basket. Other stocks and SELL entries remain. Cleanup retries if Kite rejects it; no order is executed or cancelled by this operation. A fresh below-floor observation and re-crossing can fund the stock again. Keep Rocket Scanner and Kite open; this runs on the app's status poll, so a simultaneous manual execution before fill detection is not atomically prevented.

After updating these files, reload **Kite Basket Bridge** in `chrome://extensions` (or `edge://extensions`) and hard-refresh Rocket Scanner to activate version 1.5.0.

The extension has access only to the Rocket Scanner page and Kite. It neither reads credentials nor calls order-execution APIs. It depends on Kite's current web app and fails closed if its basket API cannot be found. JSON export remains available. Live authenticated verification requires installing the bridge and opening the basket.
