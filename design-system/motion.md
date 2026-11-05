# Motion

Motion tells the story of a waffle: batter browns, wedges come together, chocolate pours, a sticker lands. Every effect is one of those physical events. If an animation is not one of them, cut it.

Tie big moves to scroll with GSAP ScrollTrigger and Lenis smooth scrolling. Previews here use a slider in place of scroll. Drag it and you are scrolling.

## The set

| Name | Trigger | What happens | Length | Runs |
| --- | --- | --- | --- | --- |
| `IronPress` | First load | Cells brown outward from the centre, the disc pulses | Under 1.2s | Once per visit |
| `StickerType` slap | Enters view | Line lands at 1.5x scale, overshoots, settles tilted | 320ms | Once |
| `Badge` stamp | Enters view, click | Drops from 1.7x, squashes, settles, then wobbles slowly | 280ms, then idle | Once, idle loop |
| `WedgeAssemble` | Scroll, pinned | Wedges arrive one by one, the waffle turns 90 degrees | 1 screen of scroll | Scrubbed |
| `DripEdge` | Scroll | Chocolate pours down and becomes the next scene | 0.6 screen of scroll | Scrubbed |
| `Ribbon` | Always | Text travels the path, speed follows scroll velocity | Endless | Loop |
| Scene swap | Scroll, pinned | Ground colour cuts to the next flavour as the sticker slides | 3 screens for 4 items | Scrubbed |
| `Anatomy` | Scroll | Waffle settles, callouts pop, arrows draw | 0.5 screen of scroll | Scrubbed |
| Footer rise | Scroll | Giant letters spring up from the bottom edge, one by one | 800ms, 50ms stagger | Once, hop on hover |
| Sticker float | Always | Cut-outs bob, and shift with the pointer | 2.4 to 2.9s | Loop |
| Card lift | Hover, focus | Card tilts, sticker pops out of the frame | 280ms | On demand |
| Button press | Press | Squashes into its own shadow | 160ms | On demand |

## Timing rules

- Use 150 to 320ms for interface feedback. Only scrubbed scroll work may run longer, because the visitor drives it.
- Enter with `back.out` or `elastic.out`, which read as physical. Exit about 35% faster than the entrance.
- Stamp with `power4.in`: weight comes from accelerating into the landing.
- Stagger lists by 30 to 60ms per item.
- Animate `transform` and `opacity` only. The drip path is the one exception and is capped at 13 drips.
- Run one big move per screen. Nothing competes with a pinned scene.

## Reduced motion and phones

- When `prefers-reduced-motion` is set, jump every timeline to its end state and stop all loops. Content never depends on animation to appear.
- Render the page complete first. Animations start from what is already visible, so a failed script leaves a finished page.
- On phones, keep the wedge assemble and drip. Replace the pinned menu with a swipe carousel, drop pointer parallax and cap the ribbon's text length.
- Pause loops when their scene is off screen.
