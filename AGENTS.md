# Agent notes

## Analytics on every website (default)

Every website in this account ships with visitor analytics, no need to ask. When you create a new site or add a new page, add analytics to it as part of the work.

- Provider: [GoatCounter](https://www.goatcounter.com). No cookies, so no consent banner. Everything goes to one dashboard, `ghanemja.goatcounter.com`.
- Copy `analytics.js` from an existing repo (for example `ghanemja/qr`'s `src/analytics.js`) and add one tag to the `<head>` of every HTML page:

  ```html
  <script src="analytics.js" data-goatcounter="ghanemja" data-site="REPO-NAME"></script>
  ```

  `data-site` is the repo or site name. It prefixes click events so sites sharing the dashboard stay apart.
- This counts page views and every link or button click (`REPO-NAME click: <label>`). For interactions that aren't links or buttons (canvas or 3D clicks, searches, form submits), call `window.track?.('what happened')`.
- Pages that aren't really for visitors, such as video render harnesses, don't need it.
