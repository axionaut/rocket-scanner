# Kite Basket Bridge

One-time setup in Chrome or Edge (the same browser/profile used for both apps):

1. Open `chrome://extensions` or `edge://extensions` and enable Developer mode.
2. Choose **Load unpacked** and select this `browser-extension` folder.
3. Reload Rocket Scanner and Kite.

Open the empty **Scanner_Import** basket in Kite. Rocket Scanner automatically sends each new funded basket after its normal file save. The **Kite auto-send** button is an optional manual retry. Keep the basket open; pending transfers retry every 20 seconds using the current live plan. Automatic transfers do not switch tabs. The bridge uses Kite's native JSON import handler, including the exported quantities and GTT targets. It verifies the basket items before reporting success. Review the basket and click Execute yourself.

An identical basket is left alone. A different non-empty basket is never overwritten or appended to: review and clear it in Kite first. Keep one Kite tab open. If an import is partial, inspect and clear it before retrying.

The extension has access only to the Rocket Scanner page and Kite. It neither reads credentials nor calls order-execution APIs. It depends on Kite's current web UI and fails closed if that component changes. JSON export remains available. Live authenticated verification requires installing the bridge and opening the basket.
