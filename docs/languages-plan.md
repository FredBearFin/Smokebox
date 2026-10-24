# Languages and voices: future plan

Status: future. Agreed with the owner on 2026-10-24. Nothing here is built yet, except the English voice work listed under "First".

## The goal

Smokebox should work well for kitchens whose crews speak other languages. Each device picks its own language, so a Spanish-speaking pit and an English-speaking counter can share one kitchen. That covers both:

- **Screen text:** every button, label, warning and Guide page.
- **Call-outs:** the spoken "fire now", "new ticket", "ready, ring it out" and "still waiting" lines.

Dish names stay exactly as the owner typed them. "Fire brisket now" in Spanish is "¡Marcha brisket ya!", with the dish name unchanged.

## The voice

The owner heard samples on 2026-10-24 and was impressed with all four English voices: michael, adam, heart and emma. They sound like a person, unlike the browser's built-in robot voice.

The engine is Kokoro (open source, Apache 2.0). It runs on our own Hetzner server, with no outside account and no per-call cost.

| | |
|---|---|
| Model size | about 350 MB |
| Time per line | about 1.5 to 2 s on 2 vCPU |
| Lines are made | when a ticket is created, minutes before they are due |
| Repeat lines | saved and reused |
| No connection | the device falls back to the browser voice, so a call is never skipped |

## Languages the voice can already speak

| Language | Kokoro voices | Notes |
|---|---|---|
| English (American) | many | |
| English (British) | several | |
| Spanish | em_alex, ef_dora | samples made 2026-10-24 |
| French | ff_siwis | sample made 2026-10-24 |
| Others | Italian, Brazilian Portuguese, Hindi, Japanese, Mandarin | |

These are not in Kokoro:

- **Russian:** needs a second engine. Piper (open source, runs on the same server) has Russian voices.
- **A Caribbean-accent English voice:** no ready-made voice was found. Options to look into later:
  - a voice-cloning engine trained from a short recording of a real speaker, with their permission;
  - a paid voice service that offers that accent.

## Decided scope (owner, 2026-10-24, updated the same day)

- **The screen stays in English.** Instead of translating it, it gets an accessibility pass so a cook who cannot read well can still follow it (see "Clear without reading" below).
- **Call-outs are spoken in English, Spanish or French.** No other languages for now.
- **Voices:**
  - English: 6 voices, 3 men and 3 women.
  - Spanish: 1 man and 1 woman.
  - French: 1 man and 1 woman. Kokoro has only one French voice (ff_siwis, a woman), and one French voice is acceptable to the owner.
- Spanish reaches the many Spanish-speaking kitchen workers in the US.
- French reaches African and Haitian workers.
  - Note: many Haitian workers use Haitian Creole day to day. French reaches some of them, not all.
  - Kokoro has no Creole voice. If kitchens ask for it, it is a later decision.

## Clear without reading

The board must say what to do without anyone reading a word. Start with:

- **The dish the voice just called flashes red on its ticket** until someone starts it.
  - Voice and screen point at the same thing.
- One clear action per dish: a big button whose color and icon say what it does (start, done).
- Station tabs and dishes marked with icons and colors, not only words.
- The coach keeps telling the cook what to do next, out loud.
- The audit checks every board screen at tablet size, asking at each step: "could a cook who cannot read do this?"

## Work, in order

1. **First (planned now):** English Kokoro call-outs in the hosted version, with the owner choosing the voice under Settings.
2. The "clear without reading" pass, starting with the flashing called dish.
3. Call-out phrases (`25-deadlines.js` `phrase()`) in one table per language, plus a call-out language and a voice per device. The screen text stays English.
4. Spanish first: a native speaker checks the kitchen wording ("marchar" and the like).
5. French, with the same native-speaker check.
