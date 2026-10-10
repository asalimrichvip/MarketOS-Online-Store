# MarketOS Online Store

Arabic-first, mobile-first customer storefront for the MarketOS supermarket app.

## Live storefront

After the GitHub Pages workflow finishes, the public static site is expected at:

https://asalimrichvip.github.io/MarketOS-Online-Store/

## Important: API connection required for real orders

GitHub Pages only serves static files. It does **not** run the MarketOS Node API or store live inventory/orders. The shop UI is published separately from the existing local backend.

To connect a real, securely hosted API, open the storefront with an API base URL, for example:

`https://asalimrichvip.github.io/MarketOS-Online-Store/?api=https://YOUR-HTTPS-API-HOST`

The API must implement the MarketOS public storefront endpoints:
- `GET /api/storefront/catalog`
- `POST /api/storefront/orders`
- `POST /api/storefront/order-status`

The backend must use persistent storage, validate prices and quantities on the server, deduct stock transactionally, support idempotency, and allow only HTTPS production access. Never use a localhost URL for the public API.

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
