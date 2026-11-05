# Site flow

The site has three jobs: make people hungry, turn visitors into WhatsApp opt-ins, and give Meta a site that verifies the business. The `SiteFlow` card shows the home page as a storyboard.

## Pages

| Route | Job | Key parts |
| --- | --- | --- |
| `/` | The scroll story | Everything below |
| `/menu` | Full menu with prices | `MenuCard` grid, filter by type, scallop photos |
| `/offers` | Current offers | `OfferTicket` list, `OptInForm` |
| `/offers/[slug]` | One offer, linked from a WhatsApp message | Poster, full terms, claim action, validity state |
| `/visit` | Address, hours, phone, map link | Name and address exactly as registered |
| `/privacy` | How phone numbers are used | Required for the consent flow |
| `/terms` | Offer terms | Linked from every ticket |
| `/opt-out` | Stop messages without replying | One field, one button |

## Home page scroll

| Scene | Colour | Content | Motion | Visitor should feel |
| --- | --- | --- | --- | --- |
| 1 Hero | Umber | Promise, order action, waffle pair, badge | `IronPress`, slap, stamp | Hungry |
| 2 The wedge | Umber | "1 of 4 is never enough" | `WedgeAssemble`, pinned | Oh, that's the logo |
| 3 Mood break | Dune | Dark stack photo, "That Drip." | `DripEdge` wipe | Craving |
| 4 The menu | Umber, Dune, Lily, Deep umber | One flavour per step | Pinned slide, scene swap | Picking a favourite |
| 5 What's inside | Just Right | Ingredient callouts | `Anatomy` | It's made with care |
| 6 Share it | Santa Fe | Boxes for groups | Flat lay parallax | Bring friends |
| 7 Offers | Umber | Live tickets and opt-in | Tickets deal in, `Ribbon` crosses | Don't miss out |
| 8 Visit | Lily | Address, hours, phone | Wedge flies to the pin | I can go today |
| 9 Footer | Dune and Umber | Curved panel, links, sign-up, giant name | Letters spring up from the edge | That's the place |

The header stays small and sticky: logo, Menu, Offers, Find us, and the primary action. On phones the primary action becomes a bottom bar.

## Three journeys

- **Hungry visitor:** lands on the hero, scrolls to the menu, picks a waffle, taps the order action or visit details.
- **WhatsApp customer:** gets an offer message, opens `/offers/[slug]`, reads the terms, claims it in the shop. An expired link shows the next live offer.
- **Meta reviewer:** opens the site, finds the same business name in the header, footer, `/visit` and `/privacy`, plus a contact email and address.

## How the WhatsApp brief shapes the site

| Client requirement | What the site does |
| --- | --- |
| Name must match on every document | One `businessName` value feeds all pages, legal copy and metadata |
| Website or online presence | `/visit` and the footer list address, email and social links |
| Customer consent | `OptInForm` stores Name, Phone with +91 and Opted in, matching the Excel columns, plus timestamp and source page |
| Offer text and posters | Offers load from the admin data: name, discount, validity, terms, poster under 5 MB |
| Logo and brand colours | Tokens here feed the admin dashboard; the WhatsApp profile picture uses `badge-waffle` |

## Build plan

1. Set up Next.js with these tokens, GSAP ScrollTrigger and Lenis.
2. Build static scenes first, complete with no animation, and check phones.
3. Add the signature motion: wedge, drip, ribbon, scene swap.
4. Connect offers data and the opt-in form with a real store.
5. Write privacy, terms and opt-out with the client's real details.
6. Run accessibility, reduced-motion and Core Web Vitals checks, then deploy.

## Needed from the client

- Exact registered name, including whether it has the exclamation mark.
- Address, opening hours, phone, email and social links.
- Full menu with real names and prices. The "That ___ One" names are working names.
- First 2 to 3 real offers with posters.
- Original vector logo. The SVGs here are traced from a 1500px PNG.
- How orders work: WhatsApp, walk-in or delivery apps. The dedicated Meta number may not suit two-way ordering.
