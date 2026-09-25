# Kite Basket Bridge

One-time setup in Chrome or Edge (the same browser/profile used for both apps):

1. Open `chrome://extensions` or `edge://extensions` and enable Developer mode.
2. Choose **Load unpacked** and select this `browser-extension` folder.
3. Reload Rocket Scanner and Kite.

Keep any Kite page open and logged in, in the same browser; the basket does **not** need to be open. Rocket Scanner writes each new funded basket into **Scanner_Import** (created if missing) through Kite's own basket API, right after its normal file save. The **Kite auto-send** button resends on demand. Pending transfers retry every 20 seconds using the current live plan. The bridge verifies every item, quantity and GTT target before reporting success. Open the basket when you want to review it and click Execute yourself.

An identical basket is left alone. A basket with older orders is replaced by the new plan, unless Scanner_Import is open on screen in Kite: an open basket is never changed, because Kite executes the items shown. Close it and the next retry writes the new plan. Other baskets are never touched.

The extension has access only to the Rocket Scanner page and Kite. It neither reads credentials nor calls order-execution APIs. It depends on Kite's current web app and fails closed if its basket API cannot be found. JSON export remains available. Live authenticated verification requires installing the bridge and opening the basket.
