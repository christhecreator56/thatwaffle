That Waffle Place! is a loud, happy waffle brand in warm picnic colour. Everything grows from one fact: the logo is a quarter-circle wedge, the real waffles are served as wedges, and four wedges make a whole.

## Content fundamentals

- Lead with the word **That**. Name things the way a regular would: "That Red One", "That Crunchy One", "That Sharing Box", "That Offer", "Find That Place".
- Write short and declarative: "that crunch. that melt." Two to five words per line of display type.
- Set `display-xl`, `display-lg` and `display-md` in lowercase. The blob letters are fattest there. Set `poster-lg` and `label` in uppercase.
- Speak as "we" to "you". Never "customers" or "patrons".
- Use one script aside per scene at most: "you know the one".
- Write the name exactly as **That Waffle Place**, with no exclamation mark, wherever it appears as text. The legal entity is **S4 Hospitality**; show it in the footer. Meta compares these against the business documents. The logo and badges still draw the exclamation mark until the client approves a change.
- Describe only what the photo shows. Never invent ingredients, prices or claims.
- Use no emoji. Use ₹ for prices and +91 for phone numbers.
- Keep consent copy plain: "Yes, send me That Waffle Place offers on WhatsApp. I can reply STOP any time."

## Colour

Five client colours lead: `umber`, `justright`, `dune`, `santafe` and `lily`. Their hex values are exact. Each one has a close traditional Japanese colour (和色), recorded in its token note, so the Japanese thread stays in the names and the seal.

| Token | Hex | Nearest 和色 | Colour distance (ΔE) |
| --- | --- | --- | --- |
| `santafe` | #ad795a | 焦香 kogarekō | 2.8, nearly identical |
| `dune` | #2e2c25 | 蝋色 rōiro | 4.9 |
| `justright` | #eed4bc | 肌色 hada-iro | 5.6 |
| `umber` | #8a2823 | 栗梅 kuriume | 7.4 |
| `lily` | #c4acb4 | 薄柿 usugaki | 7.6 |

- Use `umber` as the brand field. It carries the hero, wedge, offers and footer.
- Treat colour as scenes. A scene is one full-width band with one ground; see the table.
- Set display letters in `justright` with a `dune` block shadow.
- Use `yamabuki` with `on-cta` for the single primary action in a view. It is the only bright colour, taken from the waffle itself.
- Keep `seiji` for the opt-in success state only.
- Use `logo-waffle`, `logo-syrup`, `logo-crust` and `logo-choc` in illustration only.
- Never use a gradient. Depth comes from flat tone, hard shadow and overlap.

| Scene | Ground | Text | Accent | Used for |
| --- | --- | --- | --- | --- |
| Umber | `umber` | `justright` | `yamabuki` | Hero, wedge, offers, red velvet, footer |
| Dune | `dune` | `justright` | `lily` | Chocolate items, mood break |
| Deep umber | `umber-deep` | `justright` | `lily` | Ice cream |
| Lily | `lily` | `dune` | `umber` at 24px+ | Strawberry, visit |
| Santa Fe | `santafe` | `dune` at 24px+ only | `justright` fill | Sharing boxes, with body copy on a `kinari` panel |
| Just Right | `justright` | `dune` | `umber` | Ingredients, reading |

## Type

- Set headlines in Modak: `display-xl`, `display-lg`, `display-md`. It stands in for Kooky Cloud. Never go below 56px, because the counters close up.
- Set sublines, card titles, labels and buttons in Ranchers: `poster-lg`, `label`. It stands in for Ellak.
- Set reading text in `body-lg`, `body` and `small`, in Zen Maru Gothic.
- Use `script-lg` for one aside only. Never set the brand name in it.
- Use `kana` for ワッフル in the ribbon and seal. Do not add other Japanese copy without a native check.
- Set the brand name as `logo-full-trace` or `wordmark-trace` in logo positions. The one exception is the giant footer sign-off, which runs in `display-xl` and keeps the full name in its accessible label.
- To use the real Ellak and Kooky Cloud, buy their webfont licences, add the files to `fonts/` and change the `display` and `poster` families. Nothing else needs to change.

## Layout

- Build the page as a stack of full-width scenes, each `space-7` top and bottom on desktop and `space-6` on phones.
- Keep a `space-3` minimum gutter.
- Let one framed photo or the waffle illustration break out of every scene. It overlaps the type or the next scene's edge. Never use cut-outs.
- Tilt stickers between 3 and 8 degrees. Keep cards and forms at 0 degrees at rest.
- Use `sticker-sm`, `sticker-md` and `sticker-lg` for hard offset shadows.
- Use `radius-lg` for cards, `radius-md` for fields, `radius-pill` for buttons and `radius-panel` for the footer's curved corner.
- Mark every interactive focus with a 3px solid `focus` ring at 2px offset.

## Motifs

Three motifs do all the work, and each comes from the food.

- **The wedge.** A quarter circle. It is the logo, a photo frame and the core animation. 青海波 seigaiha waves are built from the same arcs, so they appear at 13 to 16% opacity on `umber` only.
- **The lattice.** The waffle grid turned 45 degrees is 菱 hishi, a traditional diamond pattern. It fills the badge.
- **The drip.** Chocolate from the logo's top edge. It is the transition between scenes.

The logo's two speed dashes appear beside a moving wedge and nowhere else.

## Iconography

Draw icons as 24px line glyphs with a 2.4px stroke, round caps and `currentColor`. Keep the set small: chat, pin, clock, phone, box, Instagram, Facebook. Use the official WhatsApp mark only if the client's Meta approval allows it; until then use the chat glyph in `Button`. Spot illustrations are flat, three tones per object, no outline; see Illustration and imagery.

## Rules that protect the client

- Keep third-party brands out of frame. Use only the supplied crops in the Photos group; two source photos show a branded spread jar and foil chocolates that are cropped away.
- Show offers only with name, discount, validity dates and terms.
- Never tick the consent box by default.
