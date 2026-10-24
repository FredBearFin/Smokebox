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

## Work, in order

1. **First (planned now):** English Kokoro call-outs in the hosted version, with the owner choosing the voice under Settings.
2. Move every piece of screen text and every call-out phrase into one table per language.
   - The phrases live in `25-deadlines.js` `phrase()`; the screen text is spread across the UI files.
3. A language setting per device, plus a voice per language.
4. Spanish first: a native speaker checks the kitchen wording ("marchar" and the like).
5. French, then other languages as kitchens ask for them.
