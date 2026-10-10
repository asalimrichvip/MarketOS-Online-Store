# MarketOS Online Store

Arabic-first, mobile-first customer storefront for the MarketOS supermarket app.

## Live storefront

After the GitHub Pages workflow finishes, the public static site is expected at:

https://asalimrichvip.github.io/MarketOS-Online-Store/

## Google Sheets-backed API

GitHub Pages hosts the public storefront only. The Sheets-backed API source is in `apps-script/Code.gs`; follow [the Arabic setup guide](apps-script/DEPLOYMENT_AR.md) to publish it as a Google Apps Script Web App and connect its `/exec` URL to the storefront.

The `Settings.orders_enabled` value remains `FALSE` until testing is deliberately enabled. Before accepting customer orders, restrict spreadsheet sharing because Orders will contain customer contact and delivery details.

## Security boundaries

- This repository contains the public customer storefront only.
- The staff order-management screen must remain behind MarketOS staff authentication and the server-side `online-orders:manage` permission; do not publish staff credentials, session tokens, the local database, backups, or `.env` files here.
- Do not treat the storefront as accepting live orders until the API is deployed and connected.

## Included

- Arabic RTL storefront with responsive mobile layout
- Product search and availability labels
- Basket, delivery details and cash-on-delivery checkout UI
- Customer order tracking page with live status refresh
- Installable PWA shell for the customer storefront
- GitHub Actions workflow to publish the static site with GitHub Pages
